// Load environment variables from local.env file
require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

// Discord bot setup
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// OpenAI setup
const OpenAI = require('openai');
let openai = null;

// Persistent configuration file
const CONFIG_FILE = '/app/data/config.json'; // production DONT DELETE
//const CONFIG_FILE = 'config.json'; // Testing
let serverConfigs = {};

// Load configuration from file
function loadConfig() {
    if (fs.existsSync(CONFIG_FILE)) {
        serverConfigs = JSON.parse(fs.readFileSync(CONFIG_FILE));
        console.log('Loaded server configurations:', serverConfigs); // Debugging statement
        // Initialize OpenAI with the first available API key
        const firstConfig = Object.values(serverConfigs)[0];
        if (firstConfig && firstConfig.openAiKey) {
            openai = new OpenAI({ apiKey: firstConfig.openAiKey });
        }
        console.log('Configuration loaded.');
    } else {
        console.log('No configuration found. Please run /setup to configure the bot.');
    }
}

// Save configuration to file
function saveConfig() {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(serverConfigs, null, 4));
    console.log('Configuration saved.');
}

// Reset configuration for a specific server
function resetServerConfig(guildId) {
    if (serverConfigs[guildId]) {
        delete serverConfigs[guildId];
        saveConfig();
    }
    console.log(`Configuration reset for server ${guildId}.`);
}

// Forum URL to monitor
const FORUM_URL = 'https://robertsspaceindustries.com/spectrum/community/SC/forum/190048';

// Global state for forum monitoring
let latestThreadUrl = null;
let lastPatchNotesData = null; // Cache the latest patch notes

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

// Function to process patch notes with ChatGPT
async function processPatchNotesWithChatGPT(content) {
    if (!openai) {
        console.error('OpenAI API key is not set. Please run /setup to configure it.');
        return null;
    }

    try {
        const prompt = `You are a helpful assistant that formats patch notes for Star Citizen. Don't include a release date/time! Besides this, YOU MUST INCLUDE EVERYTHING FROM THE TITLE AT THE TOP TO THE END OF THE TECHNICAL CATEGORY! Make sure to show any special requests or any testing/feedback focus. Include all Known issues, Features & Gameplay, Bug Fixes, and Technical. Use markdown for formatting:\n\n${content}`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'You are a helpful assistant that formats patch notes for Star Citizen.' },
                { role: 'user', content: prompt },
            ],
            max_tokens: 3500,
        });

        return response.choices[0].message.content.trim();
    } catch (error) {
        console.error('Error processing patch notes with ChatGPT:', error);
        return null;
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

        const contentMain = $('div.content-main');
        if (!contentMain.length) {
            console.error('No content found in the main container.');
            return null;
        }

        const rawContent = contentMain.text().trim();
        if (!rawContent) {
            console.error('No content extracted from the patch notes page.');
            return null;
        }

        const formattedContent = await processPatchNotesWithChatGPT(rawContent);
        if (!formattedContent) {
            console.error('ChatGPT failed to process the patch notes.');
            return null;
        }

        return { url, content: formattedContent };
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
    if (Object.keys(serverConfigs).length === 0) {
        console.log('No servers configured. Skipping update check.');
        return;
    }

    try {
        const latestUrl = await getLatestThreadUrl();

        if (latestUrl && latestUrl !== latestThreadUrl) {
            console.log('New thread detected! Fetching patch notes...');
            latestThreadUrl = latestUrl;

            const patchNotesData = await getLatestPatchNotesContent(latestUrl);
            if (patchNotesData && patchNotesData.content) {
                lastPatchNotesData = patchNotesData; // Cache the patch notes
                await distributeUpdatesToServers(patchNotesData);
            }
        }
    } catch (error) {
        console.error('Error in checkForUpdates:', error);
    }
}

// New function to handle distributing updates to all configured servers
async function distributeUpdatesToServers(patchNotesData) {
    const { url, content } = patchNotesData;
    const parts = content.match(/.{1,2000}/gs) || [];

    // Process servers in batches to avoid rate limits
    const batchSize = 10;
    const serverEntries = Object.entries(serverConfigs);
    
    for (let i = 0; i < serverEntries.length; i += batchSize) {
        const batch = serverEntries.slice(i, i + batchSize);
        
        await Promise.allSettled(batch.map(async ([guildId, config]) => {
            try {
                const channel = await client.channels.fetch(config.channelId);
                if (!channel) {
                    console.log(`Channel not found for server ${guildId}. Skipping.`);
                    return;
                }

                const roleMention = config.pingRoleId ? `<@&${config.pingRoleId}>` : '';
                
                // Send initial message with ping
                await channel.send(`${roleMention} **New Patch Has Just Dropped!**\n${url}`);

                // Send content in parts with rate limiting
                for (const [index, part] of parts.entries()) {
                    await channel.send({
                        content: part,
                        flags: index > 0 ? MessageFlags.SuppressNotifications : 0
                    });
                    await new Promise(resolve => setTimeout(resolve, 500)); // Add delay between messages
                }

                console.log(`Successfully posted update to server ${guildId}`);
            } catch (error) {
                console.error(`Failed to post update to server ${guildId}:`, error);
            }
        }));

        // Add delay between batches to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

// Modify the permission check function
async function checkAdminPermission(interaction) {
    if (!interaction.member.permissions.has('Administrator')) {
        await interaction.reply({
            content: 'This command is only available to server administrators.',
            ephemeral: true
        });
        return false;
    }
    return true;
}

// Then modify the command handling to properly await the check
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand() && !interaction.isButton()) return;

    if (interaction.isCommand()) {
        // Check admin permissions for all commands
        const hasPermission = await checkAdminPermission(interaction);
        if (!hasPermission) return;

        if (interaction.commandName === 'setup') {
            try {
                await interaction.deferReply({ ephemeral: true });

                const channel = interaction.options.getChannel('channel');
                const pingRole = interaction.options.getRole('pingrole');
                const openAiKey = interaction.options.getString('openai_key');

                if (!openAiKey) {
                    await interaction.editReply('An OpenAI API key is required to set up the bot. Please provide one. You can get an API key from https://platform.openai.com/account/api-keys', { ephemeral: true });
                    console.error('OpenAi API key not provided during setup.');
                    return;
                }

                // Save server-specific configuration
                serverConfigs[interaction.guildId] = {
                    channelId: channel.id,
                    pingRoleId: pingRole ? pingRole.id : null,
                    openAiKey: openAiKey
                };
                
                saveConfig();

                // Initialize OpenAI if not already initialized
                if (!openai) {
                    openai = new OpenAI({ apiKey: openAiKey });
                }

                await interaction.editReply({
                    content: `Patch notes will now be posted in <#${channel.id}>${
                        pingRole ? ` and will ping <@&${pingRole.id}>` : ''
                    }.`
                });

                console.log(
                    `Setup complete: Channel ID = ${channel.id}, Ping Role ID = ${
                        pingRole ? pingRole.id : 'None'
                    }, OpenAI Key Provided: ${!!openAiKey}`
                );
            } catch (error) {
                console.error('Error handling /setup command:', error.message);

                // Attempt to reply with an error message if the interaction isn't replied to
                try {
                    await interaction.editReply('An error occurred while processing your request.');
                } catch (replyError) {
                    console.error('Failed to edit reply:', replyError.message);
                }
            }
        } else if (interaction.commandName === 'patchnotes') {
            const serverConfig = serverConfigs[interaction.guildId];
            if (!serverConfig) {
                await interaction.reply({
                    content: 'This server is not configured. Please run `/setup` first.',
                    ephemeral: true
                });
                return;
            }

            try {
                await interaction.deferReply();

                // Use cached patch notes if available, otherwise fetch new ones
                const patchNotesData = lastPatchNotesData || await getLatestPatchNotesContent(latestThreadUrl);
                if (patchNotesData) {
                    const { url, content } = patchNotesData;
                    const channel = await client.channels.fetch(serverConfig.channelId);
                    
                    if (!channel) {
                        await interaction.editReply('Error: Could not find the configured channel.');
                        return;
                    }

                    const roleMention = serverConfig.pingRoleId ? `<@&${serverConfig.pingRoleId}>` : '';
                    await channel.send(`${roleMention} **Latest Star Citizen Patch Notes:**\n${url}`);

                    const parts = content.match(/.{1,2000}/gs) || [];
                    for (const part of parts) {
                        await channel.send(part);
                        await new Promise(resolve => setTimeout(resolve, 500)); // Rate limiting
                    }

                    await interaction.editReply('Patch notes have been posted.');
                } else {
                    await interaction.editReply('Could not fetch the latest patch notes. Please try again later.');
                }
            } catch (error) {
                console.error('Error handling /patchnotes command:', error);
                await interaction.editReply('An error occurred while processing your request.');
            }
        } else if (interaction.commandName === 'reset') {
            try {
                await interaction.deferReply({ ephemeral: true });

                // Reset server-specific configuration
                resetServerConfig(interaction.guildId);

                await interaction.editReply('Setup has been deleted. You will need to run `/setup` to use the bot again.');
                console.log(`Setup reset for server ${interaction.guildId}`);
            } catch (error) {
                console.error('Error handling /reset command:', error.message);
                try {
                    await interaction.editReply('An error occurred while processing your request.');
                } catch (replyError) {
                    console.error('Failed to edit reply:', replyError.message);
                }
            }
        } else if (interaction.commandName === 'help') {
            try {
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('setup')
                            .setLabel('Setup')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId('patchnotes')
                            .setLabel('Patch Notes')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId('check')
                            .setLabel('Check Status')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId('reset')
                            .setLabel('Reset')
                            .setStyle(ButtonStyle.Danger)
                    );

                await interaction.reply({
                    content: ``,
                    components: [row],
                    ephemeral: true
                });
            } catch (error) {
                console.error('Error handling /help command:', error.message);
                try {
                    await interaction.reply('An error occurred while processing your request.');
                } catch (replyError) {
                    console.error('Failed to reply:', replyError.message);
                }
            }
        } else if (interaction.commandName === 'check') {
            try {
                const serverConfig = serverConfigs[interaction.guildId];
                if (!serverConfig) {
                    await interaction.reply({
                        content: 'This server is not configured. Please run `/setup` first.',
                        ephemeral: true
                    });
                    return;
                }

                const channel = await client.channels.fetch(serverConfig.channelId).catch(() => null);
                const channelName = channel ? `#${channel.name}` : null;
                const openAiKeyStatus = serverConfig.openAiKey ? 'True' : 'False';
                const pingRole = serverConfig.pingRoleId ? `<@&${serverConfig.pingRoleId}>` : 'None';

                let connectionStatus = 'Server Not Connected, run `/setup`';
                if (channelName && openAiKeyStatus === 'True') {
                    connectionStatus = 'Server Connected';
                }

                await interaction.reply({
                    content: `
                    **Server Configuration:**
                    • **Channel:** ${channelName || 'Unknown'}
                    • **OpenAI Key Saved:** ${openAiKeyStatus}
                    • **Ping Role:** ${pingRole}
                    • **Status:** ${connectionStatus}
                    `,
                    ephemeral: true
                });
            } catch (error) {
                console.error('Error handling /check command:', error.message);
                try {
                    await interaction.reply('An error occurred while processing your request.');
                } catch (replyError) {
                    console.error('Failed to reply:', replyError.message);
                }
            }
        } else if (interaction.commandName === 'test') {
            try {
                await interaction.deferReply({ ephemeral: true });

                // Get the latest thread URL and patch notes
                const testUrl = await getLatestThreadUrl();
                if (!testUrl) {
                    await interaction.editReply('Could not fetch the latest forum thread. Test failed.');
                    return;
                }

                const patchNotesData = await getLatestPatchNotesContent(testUrl);
                if (!patchNotesData || !patchNotesData.content) {
                    await interaction.editReply('Could not fetch patch notes content. Test failed.');
                    return;
                }

                // Store the data in cache
                lastPatchNotesData = patchNotesData;
                
                // Distribute to all servers
                await distributeUpdatesToServers(patchNotesData);
                await interaction.editReply('Test successful: Latest patch notes have been distributed to all configured servers.');
                
                // Log the test event
                console.log(`Test distribution initiated by admin in server ${interaction.guildId}`);
            } catch (error) {
                console.error('Error handling /test command:', error);
                await interaction.editReply('An error occurred while testing the distribution system.');
            }
        }
    } else if (interaction.isButton()) {
        // Check admin permissions for buttons
        const hasPermission = await checkAdminPermission(interaction);
        if (!hasPermission) return;

        if (interaction.customId === 'setup') {
            await interaction.reply('Please use the `/setup` command to set up the bot. Requires OpenAI API Key - https://platform.openai.com/account/api-keys', { ephemeral: true });
        } else if (interaction.customId === 'patchnotes') {
            await interaction.reply('Please use the `/patchnotes` command to fetch the latest patch notes. /setup must be run once first');
        } else if (interaction.customId === 'reset') {
            await interaction.reply('Please use the `/reset` command to reset the bot setup.');
        } else if (interaction.customId === 'check') {
            await interaction.reply('Please use the `/check` command to check the bot setup status.');
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
    {
        name: 'setup',
        description: 'Set up the bot to post patch notes and configure OpenAI and add an optional role to ping',
        options: [
            {
                name: 'channel',
                type: 7, // Channel type
                description: 'The channel where the bot should post patch notes',
                required: true,
            },
            {
                name: 'openai_key',
                type: 3, // String type
                description: 'Your OpenAI API key (required) - https://platform.openai.com/account/api-keys',
                required: true,
            },
            {
                name: 'pingrole',
                type: 8, // Role type
                description: 'The role to ping when new patch notes are posted (optional)',
                required: false,
            },
        ],
    },
    {
        name: 'reset',
        description: 'Reset the bot setup and delete the current configuration',
    },
    {
        name: 'help',
        description: 'Display help information about the bot commands',
    },
    {
        name: 'check',
        description: 'Check if the server is already set up and provide configuration details',
    },
    {
        name: 'test',
        description: 'Test the patch notes distribution system (Admin only)',
        options: [
            {
                name: 'message',
                type: 3, // String type
                description: 'Custom test message (optional)',
                required: false,
            }
        ],
    }
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
    loadConfig();
    
    // Initial setup
    try {
        latestThreadUrl = await getLatestThreadUrl();
        if (latestThreadUrl) {
            lastPatchNotesData = await getLatestPatchNotesContent(latestThreadUrl);
        }
    } catch (error) {
        console.error('Error during initial setup:', error);
    }

    // Check for updates every 2 minutes
    setInterval(checkForUpdates, 120000);
});
