# Forums Image Downloader
Instructions for use:

 1. Clone this repository
 2. Ensure you have the latest versions of [Node.js](https://nodejs.org/) and [npm](https://docs.npmjs.com/try-the-latest-stable-version-of-npm)
 3. `cd` into the repo's directory on your local machine
 4. Run `npm install` in your terminal to install the necessary dependencies
 5. Run `npm start` to begin running the script
 6. The first time you run the script, you'll be prompted with two questions:
     6a. First, provide your username
     6b. Second, provide your [Imgur API Client ID](https://apidocs.imgur.com)
 7. Every time you start the script, you'll also be asked how many images you would like to download concurrently. The default is **5**. Raising the concurrency could cause network and CPU usage issues, while lowering it will make the process take longer. You can play around with the number to see what works for you.
 8. Hurray! The script should start downloading images and you'll see the progress displayed in the terminal.

To kill the script, you can use `CMD/CTRL + C` in the terminal. All progress is saved, so feel free to stop the script and resume it at a later time.

The full list of URLs exceeds 80,000 entries, but you will only be downloading about 1/3 of those images.

You're going to encounter many errors when running the script. This is normal, as many of the images you'll be attempting to download from the internet no longer exist.

Have fun!