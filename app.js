import fs from "fs";
import logUpdate from "log-update";
import { Readable } from "stream";
import dotenv from "dotenv";
import readline from "readline";
dotenv.config();
let clientId = process.env.CLIENT_ID || "";
let index = 0;
const getImgurAlbumLinks = async (hash) => {
    try {
        let links = [];
        let response = await fetch(`https://api.imgur.com/3/album/${hash}/images`, { headers: { "Authorization": `Client-ID ${clientId}` } });
        if (response.status === 404) {
            const data = await fetch(`https://api.imgur.com/3/image/${hash}`, { headers: { "Authorization": `Client-ID ${clientId}` } })
                .then(res => res.json());
            links.push(data.data.link);
        }
        else {
            const data = await response.json();
            if (data) {
                for (let image of data) {
                    links.push(image.link);
                }
            }
        }
        return links;
    }
    catch (error) {
        logUpdateError(`${hash} album hash failed`);
        await saveError(`hash: ${hash}`);
        return;
    }
};
const processUrl = async (url) => {
    try {
        const originalUrl = url;
        const urlWithoutProtocol = url.replace(/^https?:\/\//, '');
        if (urlWithoutProtocol.startsWith("imgur.com/a/") || urlWithoutProtocol.startsWith("imgur.com/gallery/")) {
            const hash = urlWithoutProtocol.split("/").pop();
            if (hash) {
                const links = await getImgurAlbumLinks(hash);
                if (links && links.length > 0) {
                    for (let link of links) {
                        processUrl(link);
                    }
                }
                return;
            }
        }
        const tinypicRegex = /^http:\/\/[\w.-]*\.tinypic\.com/;
        if (url.match(tinypicRegex)) {
            logUpdateError(`Skipping URL ${url}, Tinypic links no longer work as of 2019.`);
            await saveError(originalUrl);
            return;
        }
        const response = await fetch(url);
        if (response.redirected) {
            const redirectUrl = response.url;
            const redirectUrlWithoutProtocol = redirectUrl.replace(/^https?:\/\//, '');
            if (urlWithoutProtocol !== redirectUrlWithoutProtocol) {
                url = redirectUrl;
            }
        }
        const getImageStream = async (url) => {
            try {
                const response = await fetch(url)
                    .then(res => res.arrayBuffer())
                    .then(arrayBuffer => Buffer.from(arrayBuffer));
                // Convert the buffer to a readable stream
                const readableStream = new Readable();
                readableStream.push(response);
                readableStream.push(null);
                return readableStream;
            }
            catch (error) {
                logUpdateError(`Error getting the image stream: ${error}`);
                await saveError(originalUrl);
                throw error;
            }
        };
        const image = await getImageStream(url);
        if (!fs.existsSync("images")) {
            await fs.promises.mkdir("images", { recursive: true });
        }
        const fileName = () => {
            const newUrl = originalUrl.replace(/^https?:\/\//, '').replaceAll("/", "_");
            const splitUrl = newUrl.split(".");
            let fileName = "";
            splitUrl.forEach((segment, index) => {
                if (index === splitUrl.length - 1) {
                    fileName += "." + segment;
                }
                else {
                    fileName += segment;
                }
            });
            return fileName;
        };
        const stream = await generateFileStream(fileName());
        if (stream) {
            await new Promise((resolve, reject) => {
                image.pipe(stream)
                    .on("finish", async () => {
                    resolve();
                })
                    .on("error", async (error) => {
                    if (!error.message.startsWith("EEXIST: file already exists")) {
                        logUpdateError(`Error saving the image: ${error.message}`);
                        await saveError(originalUrl);
                        reject(error);
                    }
                    else {
                        logUpdateError(error.message);
                        await saveError(originalUrl);
                    }
                });
            });
        }
        else {
            logUpdateError('Error: Could not extract the filename from the URL');
            await saveError(originalUrl);
        }
        if (response.status >= 400) {
            logUpdateError(`Error getting ${url}: ${response.statusText}`);
            await saveError(originalUrl);
        }
    }
    catch (error) {
        logUpdateError(`Error processing ${url}`);
        await saveError(url);
    }
    await saveProgress(url);
    index++;
};
const generateFileStream = (prefix, counter = 0) => {
    return new Promise((resolve, reject) => {
        try {
            let incrementer = "";
            if (counter > 0) {
                incrementer = `(${counter})_`;
            }
            const stream = fs.createWriteStream(`./images/${incrementer}${prefix}`, { flags: "wx" });
            stream.on("error", async (error) => {
                if (error.message.startsWith("EEXIST: file already exists")) {
                    resolve(await generateFileStream(prefix, counter + 1));
                }
                else {
                    logUpdateError(error.message);
                    reject(error);
                }
            })
                .on("open", () => {
                resolve(stream);
            });
        }
        catch (error) {
            logUpdateError(`Error writing file ${prefix}`);
            reject(error);
        }
    });
};
async function createFileIfNotExists(filePath, initialContent = '') {
    try {
        await fs.promises.access(filePath, fs.constants.F_OK);
    }
    catch (error) {
        await fs.promises.writeFile(filePath, initialContent);
    }
}
async function main() {
    await createFileIfNotExists('errors.txt');
    await createFileIfNotExists('progress.txt');
    try {
        await fs.promises.access("urls.txt", fs.constants.F_OK);
    }
    catch {
        throw new Error("urls.txt file does not exist");
    }
    const completedUrls = new Set((await fs.promises.readFile("progress.txt", { encoding: "utf-8" }))
        .split("\n")
        .filter(line => line.trim() !== ""));
    const data = (await fs.promises.readFile("urls.txt", { encoding: "utf-8" }))
        .split("\n")
        .filter(line => !completedUrls.has(line.trim()));
    if (!clientId) {
        var rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        clientId = await new Promise((resolve) => {
            rl.question("What is your Imgur API Client ID? ", async function (response) {
                rl.close();
                resolve(response);
                try {
                    await fs.promises.writeFile('.env', `CLIENT_ID=${response}`);
                }
                catch (error) {
                    logUpdateError("Error writing CLIENT_ID to .env file");
                }
            });
        });
    }
    const concurrency = 10;
    const asyncQueue = new AsyncQueue(concurrency);
    logUpdate(`${index} of ${data.length} Completed (${(index / (data.length - 1) * 100).toFixed(2)}%) - Remaining Time: ${-1}`);
    const startTime = Date.now();
    setInterval(() => {
        const elapsedTime = Date.now() - startTime;
        const remainingTime = ((data.length - index) / (index / elapsedTime)) - elapsedTime;
        progressMessage = `${index} of ${data.length} Completed (${(index / (data.length - 1) * 100).toFixed(2)}%) - Remaining Time: ${msToHMS(remainingTime)}`;
        logUpdate(progressMessage);
    }, 1000);
    for (const url of data) {
        asyncQueue.push(() => processUrl(url));
    }
    await asyncQueue.finish();
}
main().catch((error) => logUpdateError(error));
let progressMessage = "";
function logUpdateError(message) {
    logUpdate.clear();
    logUpdate(message);
    logUpdate.done();
    logUpdate(progressMessage);
}
async function saveProgress(url) {
    try {
        await fs.promises.appendFile("progress.txt", `${url}\n`, { encoding: "utf-8" });
    }
    catch (error) {
        logUpdateError(`Error saving progress file`);
    }
}
async function saveError(url) {
    try {
        await fs.promises.appendFile("errors.txt", `${url}\n`, { encoding: "utf-8" });
    }
    catch (error) {
        logUpdateError(`Error saving errors file`);
    }
}
function msToHMS(ms) {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    return `${hours}h ${minutes}m ${seconds}s`;
}
class AsyncQueue {
    concurrency;
    active;
    queue;
    constructor(concurrency) {
        this.concurrency = concurrency;
        this.active = 0;
        this.queue = [];
    }
    push(task) {
        return new Promise((resolve) => {
            this.queue.push(async () => {
                await task();
                resolve();
                this.processTask();
            });
            this.processTask();
        });
    }
    async processTask() {
        if (this.active >= this.concurrency || this.queue.length === 0) {
            return;
        }
        this.active++;
        const task = this.queue.shift();
        if (task) {
            await task();
        }
        this.active--;
    }
    async finish() {
        return new Promise((resolve) => {
            const checkCompletion = setInterval(() => {
                if (this.active === 0 && this.queue.length === 0) {
                    clearInterval(checkCompletion);
                    resolve();
                }
            }, 100);
        });
    }
}