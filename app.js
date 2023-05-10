import fs from "fs";
import logUpdate from "log-update";
import { Readable } from "stream";
import dotenv from "dotenv";
import inquirer from "inquirer";
dotenv.config();
let clientId = process.env.CLIENT_ID || "";
let userId = process.env.USER_ID ? parseInt(process.env.USER_ID) : undefined;
let index = 0;
let imgurCount = 0;
let asyncQueue;
const completedUrls = new Set();
const errorUrls = new Set();
var Users;
(function (Users) {
    Users[Users["BuzzerBee"] = 0] = "BuzzerBee";
    Users[Users["Different55"] = 1] = "Different55";
    Users[Users["Tomahawk"] = 2] = "Tomahawk";
})(Users || (Users = {}));
const getImgurAlbumLinks = async (hash, originalUrl) => {
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
        logUpdateError(`Error getting image from Imgur hash ${hash}`);
        await saveError(originalUrl);
        return;
    }
};
const processUrl = async (url) => {
    try {
        const originalUrl = url;
        const urlWithoutProtocol = url.replace(/^https?:\/\//, '');
        if (urlWithoutProtocol.startsWith("imgur.com") || urlWithoutProtocol.startsWith("i.imgur.com")) {
            imgurCount++;
            if (imgurCount >= 12_250) {
                logUpdateError("Warning! Approaching Imgur rate limit");
                console.log("Approaching Imgur rate limit. Shutting down. Please try again in 24 hours.");
                await saveImgurCount();
                asyncQueue.startShutdown();
            }
        }
        if (urlWithoutProtocol.startsWith("imgur.com/a/") || urlWithoutProtocol.startsWith("imgur.com/gallery/")) {
            const hash = urlWithoutProtocol.split("/").pop();
            if (hash) {
                const links = await getImgurAlbumLinks(hash, originalUrl);
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
                if (redirectUrl === "https://i.imgur.com/removed.png") {
                    logUpdateError(`Skipping URL ${url}, this Imgur image no longer exists.`);
                    await saveError(originalUrl);
                }
                url = redirectUrl;
            }
        }
        const getImageStream = async (url) => {
            try {
                const response = await fetch(url)
                    .then(res => res.arrayBuffer())
                    .then(arrayBuffer => Buffer.from(arrayBuffer));
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
                    logUpdateError(`Error saving the image: ${error.message}`);
                    reject(error);
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
    setInterval(saveImgurCount, 60 * 1000);
    process.on('beforeExit', saveImgurCount);
    await createFileIfNotExists('errors.txt');
    await createFileIfNotExists('progress.txt');
    try {
        const imgurCountFile = await fs.promises.readFile("imgurCount.txt", { encoding: "utf-8" });
        const [savedImgurCount, savedTime] = imgurCountFile.split(",");
        imgurCount = Number(savedImgurCount);
        const elapsedTime = Date.now() - Number(savedTime);
        if (elapsedTime >= 24 * 60 * 60 * 1000) {
            imgurCount = 0;
        }
    }
    catch (error) {
        imgurCount = 0;
    }
    if (imgurCount >= 12_250) {
        logUpdateError("Warning! Approaching Imgur rate limit");
        console.log("Approaching Imgur rate limit. Shutting down. Please try again in 24 hours.");
        process.exit();
    }
    const data = [];
    await fetch("https://raw.githubusercontent.com/ConnorMcGehee/ImageDownloader/main/urls.txt")
        .then(res => res.text())
        .then(text => {
        const urls = text.split("\n");
        for (let url of urls) {
            data.push(url);
        }
    })
        .catch(error => {
        throw new Error("Couldn't fetch image URL list: ", error.message);
    });
    const completedUrlsArray = (await fs.promises.readFile("progress.txt", { encoding: "utf-8" }))
        .split("\n")
        .filter(line => line.trim() !== "");
    for (let url of completedUrlsArray) {
        completedUrls.add(url);
    }
    const errorUrlsArray = (await fs.promises.readFile("errors.txt", { encoding: "utf-8" }))
        .split("\n")
        .filter(line => line.trim() !== "");
    for (let url of errorUrlsArray) {
        errorUrls.add(url);
    }
    const questions = [];
    if (userId === undefined) {
        questions.push({
            type: 'list',
            name: 'user',
            message: 'Who are you?',
            choices: ["BuzzerBee", "Different55", "Tomahawk"]
        });
    }
    if (!clientId) {
        questions.push({
            name: "clientId",
            message: "What is your Imgur API Client ID?"
        });
    }
    await inquirer.prompt(questions).then(async (answers) => {
        userId = userId !== undefined ? userId : Users[answers.user];
        clientId = clientId ? clientId : answers.clientId;
    });
    let validClientId = false;
    while (!validClientId) {
        await fetch('https://api.imgur.com/3/image/4ihzAJ5', { headers: { 'Authorization': `Client-ID ${clientId}` } })
            .then(res => res.json())
            .then(data => {
            if (!data.data.error) {
                validClientId = true;
            }
        });
        if (validClientId) {
            break;
        }
        const invalidPrompt = [
            {
                name: "validId",
                message: "Invalid Imgur API Client ID. Please enter a valid ID:"
            }
        ];
        await inquirer.prompt(invalidPrompt).then(async (answer) => {
            clientId = answer.validId;
        });
    }
    try {
        await fs.promises.writeFile('.env', `CLIENT_ID=${clientId}\nUSER_ID=${userId}`);
    }
    catch (error) {
        logUpdateError("Error writing to .env file");
    }
    let concurrency = 5;
    questions.length = 0;
    questions.push({
        name: "concurrency",
        message: "How many images would you like to download concurrently? (Default 5, press enter to skip)"
    });
    await inquirer.prompt(questions).then(async (answer) => {
        if (answer.concurrency) {
            concurrency = answer.concurrency;
        }
    });
    asyncQueue = new AsyncQueue(concurrency);
    logUpdate(`0 of 0 Completed (0.00%) - Remaining Time: ${msToHMS(NaN)}`);
    const startTime = Date.now();
    let length = 0;
    setInterval(() => {
        const elapsedTime = Date.now() - startTime;
        const remainingTime = ((length - index) / (index / elapsedTime)) - elapsedTime;
        progressMessage = `${index} of ${length} Completed (${(index / (length - 1) * 100).toFixed(2)}%) - Remaining Time: ${msToHMS(remainingTime)}`;
        logUpdate(progressMessage);
    }, 1000);
    data.forEach((url, index) => {
        if (!completedUrls.has(url) && !errorUrls.has(url) && index % 3 === userId) {
            length++;
            asyncQueue.push(() => processUrl(url)).catch(async (error) => {
                logUpdateError(error);
                await saveError(url);
            });
        }
    });
    await asyncQueue.finish();
    logUpdate("Finished!");
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
        if (!completedUrls.has(url)) {
            completedUrls.add(url);
            await fs.promises.appendFile("progress.txt", `${url}\n`, { encoding: "utf-8" });
        }
    }
    catch (error) {
        logUpdateError(`Error saving progress file`);
    }
}
async function saveError(url) {
    try {
        if (!errorUrls.has(url)) {
            errorUrls.add(url);
            await fs.promises.appendFile("errors.txt", `${url}\n`, { encoding: "utf-8" });
        }
    }
    catch (error) {
        logUpdateError(`Error saving errors file`);
    }
}
async function saveImgurCount() {
    try {
        let timestamp = Date.now();
        // Check if file exists and get timestamp
        try {
            const imgurCountFile = await fs.promises.readFile("imgurCount.txt", { encoding: "utf-8" });
            const [, savedTime] = imgurCountFile.split(",");
            timestamp = Number(savedTime);
        }
        catch (error) {
            // File does not exist, use current timestamp
        }
        // Check if timestamp is older than 24 hours
        const elapsedTime = Date.now() - timestamp;
        if (elapsedTime >= 24 * 60 * 60 * 1000) { // 24 hours in milliseconds
            // More than 24 hours have passed, update timestamp
            timestamp = Date.now();
        }
        await fs.promises.writeFile("imgurCount.txt", `${imgurCount},${timestamp}`, { encoding: "utf-8" });
    }
    catch (error) {
        logUpdateError(`Error saving imgurCount file`);
    }
}
function msToHMS(ms) {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    return `${hours}h ${minutes}m ${seconds}s`;
}
class AsyncQueue {
    shuttingDown;
    concurrency;
    active;
    queue;
    constructor(concurrency) {
        this.concurrency = concurrency;
        this.active = 0;
        this.queue = [];
        this.shuttingDown = false;
    }
    push(task) {
        if (this.shuttingDown) {
            return Promise.reject(new Error('Shutdown in progress'));
        }
        return new Promise((resolve) => {
            this.queue.push(async () => {
                await task();
                resolve();
                this.processTask();
            });
            this.processTask();
        });
    }
    startShutdown() {
        this.shuttingDown = true;
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
