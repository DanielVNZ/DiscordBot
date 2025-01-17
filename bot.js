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
            args: ['--no-sandbox', '--disable-setuid-sandbox'] // Add these arguments
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
// Function to fetch and format patch notes
async function getLatestPatchNotesContent(url) {
    let browser;

    try {
        console.log('Launching browser to fetch patch notes...');
        browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'] // Add these arguments
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

        contentMain.find('h1, h2, h3, p, ul, blockquote').each((_, element) => {
            if (stopProcessing) return; // Stop processing if the flag is set

            const tagName = $(element).prop('tagName').toLowerCase();
            const text = $(element).text().trim();

            // Add the first title only once at the beginning
            if (!firstTitleAdded && (tagName === 'h1' || tagName === 'h2')) {
                formattedContent += `### **${text}**\n\n`;
                firstTitleAdded = true; // Mark the first title as added
            } else if ((tagName === 'h1' || tagName === 'h2')) {
                // Add other titles normally
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
            await channel.send(`**New Star Citizen Patch Notes:**\n${url}`);

            if (content.length > 2000) {
                const parts = content.match(/[\s\S]{1,2000}/g);
                for (const part of parts) {
                    await channel.send(part);
                }
            } else {
                await channel.send(content);
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

            await interaction.editReply(`**Latest Star Citizen Patch Notes:**\n${url}`);

            if (content.length > 2000) {
                const parts = content.match(/[\s\S]{1,2000}/g);
                for (const part of parts) {
                    await interaction.followUp(part);
                }
            } else {
                await interaction.followUp(content);
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