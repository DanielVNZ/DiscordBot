// Load environment variables from local.env file
require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const puppeteer = require('puppeteer');
const fs = require('fs');
const cheerio = require('cheerio');

// Discord bot setup
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Forum URL to monitor
const FORUM_URL = 'https://robertsspaceindustries.com/spectrum/community/SC/forum/190048';

// Variable to store the latest thread URL
let latestThreadUrl = null;

// Function to fetch the latest thread URL
async function getLatestThreadUrl() {
    let browser;

    try {
        console.log('Launching browser to check for updates...');
        browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        console.log('Navigating to the forum page...');
        await page.goto(FORUM_URL, { waitUntil: 'networkidle2', timeout: 60000 });

        console.log('Extracting latest thread link...');
        const latestPostLink = await page.$eval('a.thread-subject', (el) => el.getAttribute('href'));
        if (!latestPostLink) {
            console.error('No latest thread found.');
            return null;
        }

        const latestPostURL = `https://robertsspaceindustries.com${latestPostLink}`;
        console.log(`Latest thread URL: ${latestPostURL}`);

        return latestPostURL;
    } catch (error) {
        console.error('Error fetching latest thread URL:', error);
        return null;
    } finally {
        if (browser) {
            console.log('Closing browser...');
            await browser.close();
        }
    }
}

// Function to fetch and format patch notes
async function getLatestPatchNotesContent(url) {
    let browser;

    try {
        console.log('Launching browser to fetch patch notes...');
        browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        console.log('Navigating to the latest patch notes page...');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        console.log('Waiting for the content to load...');
        await page.waitForSelector('div.content-main', { timeout: 60000 });

        console.log('Extracting patch notes content...');
        const html = await page.content();
        const $ = cheerio.load(html);

        // Select the main patch notes container
        const contentMain = $('div.content-main');
        if (!contentMain.length) {
            console.error('No content found in the main container.');
            return null;
        }

        // Traverse and format the content
        let formattedContent = '';
        let isTechnicalSection = false; // Flag to track if we're in the "Technical" section
        let stopProcessing = false; // Flag to stop processing after the "Technical" section
        let firstTitleAdded = false; // Flag to ensure the first title is only added once
        let firstTitleText = ''; // Store the text of the first title to avoid duplicates

        contentMain.find('h1, h2, h3, p, ul, blockquote').each((_, element) => {
            if (stopProcessing) return; // Stop processing if the flag is set

            const tagName = $(element).prop('tagName').toLowerCase();
            let text = $(element).text().trim();

            // Clean up the title text (remove "Patch Notespinned")
            if (tagName === 'h1' || tagName === 'h2') {
                text = text.replace(/Patch Notespinned/gi, '').trim();
            }

            // Add the first title only once at the beginning
            if (!firstTitleAdded && (tagName === 'h1' || tagName === 'h2')) {
                formattedContent += `### **${text}**\n\n`;
                firstTitleAdded = true; // Mark the first title as added
                firstTitleText = text; // Store the text of the first title
            } else if ((tagName === 'h1' || tagName === 'h2') && text !== firstTitleText) {
                // Add other titles only if they are not the same as the first title
                formattedContent += `### **${text}**\n\n`;
            }

            // Check if we've entered the "Technical" section
            if ((tagName === 'h1' || tagName === 'h2') && text.toLowerCase().includes('technical')) {
                isTechnicalSection = true; // We're now in the "Technical" section
            }

            // Process all content above and including the "Technical" section
            if (!stopProcessing) {
                if (tagName === 'ul') {
                    $(element)
                        .find('li')
                        .each((_, li) => {
                            formattedContent += `- ${$(li).text().trim()}\n`; // Add list items
                        });
                    formattedContent += '\n';
                } else if (tagName === 'p' || tagName === 'blockquote') {
                    formattedContent += `${text}\n\n`; // Add paragraphs or blockquotes
                }

                // Check if we've reached the end of the "Technical" section
                if (isTechnicalSection) {
                    const nextElement = $(element).next();
                    if (nextElement.length === 0 || nextElement.is('h1, h2')) {
                        stopProcessing = true; // Stop processing after this section
                    }
                }
            }
        });

        return { url, content: formattedContent.trim() };
    } catch (error) {
        console.error('Error fetching patch notes content:', error);
        return null;
    } finally {
        if (browser) {
            console.log('Closing browser...');
            await browser.close();
        }
    }
}

// Function to check for updates and post patch notes
async function checkForUpdates() {
    console.log('Checking for updates...');
    const latestUrl = await getLatestThreadUrl();

    if (latestUrl && latestUrl !== latestThreadUrl) {
        console.log('New thread detected! Fetching patch notes...');
        latestThreadUrl = latestUrl; // Update the latest thread URL

        const patchNotesData = await getLatestPatchNotesContent(latestUrl);
        if (patchNotesData) {
            const { url, content } = patchNotesData;

            const channel = await client.channels.fetch(process.env.CHANNEL_ID);

            // Ping the "patch updates" role
            const roleMention = `<@&${process.env.PATCH_UPDATES_ROLE_ID}>`;
            await channel.send(`${roleMention} **New Star Citizen Patch Notes:**\n${url}`);

            // Split content into chunks of 2000 characters or fewer
            const parts = content.match(/[\s\S]{1,2000}/g) || [];

            // Send each part as a standalone message
            for (const part of parts) {
                await channel.send(part); // Each message is independent
            }

            console.log('Patch notes posted in the specified channel.');
        } else {
            console.error('Could not fetch the latest patch notes.');
        }
    } else {
        console.log('No new thread detected.');
    }
}

// Command handling
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'patchnotes') {
        await interaction.deferReply();

        console.log('Fetching latest patch notes...');
        const patchNotesData = await getLatestPatchNotesContent(latestThreadUrl);

        if (patchNotesData) {
            const { url, content } = patchNotesData;

            // Ping the "patch updates" role
            const roleMention = `<@&${process.env.PATCH_UPDATES_ROLE_ID}>`;
            await interaction.editReply(`${roleMention} **Latest Star Citizen Patch Notes:**\n${url}`);

            // Split content into chunks of 2000 characters or fewer
            const parts = content.match(/[\s\S]{1,2000}/g) || [];

            // Fetch the channel where the command was used
            const channel = interaction.channel;

            // Send each part as a standalone message in the channel
            for (const part of parts) {
                await channel.send(part); // Each message is independent
            }
        } else {
            await interaction.editReply('Could not fetch the latest patch notes. Please try again later.');
        }
    }
});
// Login to Discord
client.login(process.env.TOKEN);

// Slash command registration
const commands = [
    {
        name: 'patchnotes',
        description: 'Fetch the latest Star Citizen patch notes',
    },
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();

// Start polling for updates
client.once('ready', async () => {
    console.log('Bot is ready!');
    latestThreadUrl = await getLatestThreadUrl(); // Initialize the latest thread URL
    setInterval(checkForUpdates, 60000); // Check for updates every 60 seconds
});