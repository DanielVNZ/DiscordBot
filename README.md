# Star Citizen Patch Notes Discord Bot

A Discord bot that automatically fetches and posts the latest Star Citizen patch notes from the official Spectrum forum. It can also be manually triggered using the `/patchnotes` command. The bot uses Puppeteer for web scraping and ChatGPT (via OpenAI API) to format the patch notes for better readability.

## Features

- **Automatic Updates**: Fetches and posts new patch notes as soon as they are published.
- **Manual Trigger**: Use the `/patchnotes` command to fetch and post the latest patch notes at any time.
- **ChatGPT Integration**: Formats patch notes for clarity and readability.
- **Role Mention**: Pings a specific role (e.g., `@Patch Updates`) when new patch notes are posted.

## Prerequisites

Before running the bot, ensure you have the following:

- **Node.js** (v16 or higher) installed on your system.
- **A Discord Bot Token** from the [Discord Developer Portal](https://discord.com/developers/applications).
- **An OpenAI API Key** from [OpenAI](https://platform.openai.com/signup/).
- **A Discord Server** where the bot will be deployed.

## Setup

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/star-citizen-patch-notes-bot.git
cd star-citizen-patch-notes-bot
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Create a `.env` File

Create a `.env` file in the root directory of the project and add the following variables:

```env
TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_bot_client_id
CHANNEL_ID=your_discord_channel_id
PATCH_UPDATES_ROLE_ID=your_patch_updates_role_id
OPENAI_API_KEY=your_openai_api_key
```

Replace the placeholders with your actual credentials.

### 4. Invite the Bot to Your Server

Use the following URL to invite the bot to your Discord server. Replace `YOUR_CLIENT_ID` with your bot's client ID:

```plaintext
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=2147485696&scope=bot%20applications.commands
```

### 5. Run the Bot

```bash
npm start
```

The bot will start monitoring the Star Citizen Spectrum forum for new patch notes and post them in the specified channel.

## Usage

### Automatic Updates

The bot checks for new patch notes every 60 seconds. If a new thread is detected, it will:

1. Fetch the patch notes.
2. Format them using ChatGPT.
3. Post them in the specified Discord channel.
4. Mention the `@Patch Updates` role (if configured).

### Manual Trigger

Use the `/patchnotes` command in your Discord server to manually fetch and post the latest patch notes.

## Configuration

### Environment Variables

| Variable                | Description                                                     |
|-------------------------|-----------------------------------------------------------------|
| `TOKEN`                | Your Discord bot token.                                        |
| `CLIENT_ID`            | Your Discord bot client ID.                                    |
| `CHANNEL_ID`           | The ID of the Discord channel where patch notes will be posted.|
| `PATCH_UPDATES_ROLE_ID`| The ID of the role to mention when new patch notes are posted.  |
| `OPENAI_API_KEY`       | Your OpenAI API key for ChatGPT integration.                   |

### Customizing the Forum URL

If you want to monitor a different forum, update the `FORUM_URL` variable in `bot.js`:

```javascript
const FORUM_URL = 'https://robertsspaceindustries.com/spectrum/community/SC/forum/190048';
```

## Technologies Used

- **[Discord.js](https://discord.js.org/)**: Interacting with the Discord API.
- **[Puppeteer](https://pptr.dev/)**: Web scraping to fetch patch notes from the Spectrum forum.
- **[Cheerio](https://cheerio.js.org/)**: Parsing and extracting data from HTML.
- **[OpenAI API](https://openai.com/)**: Formatting patch notes using ChatGPT.

## Contributing

Contributions are welcome! If you'd like to improve the bot, follow these steps:

1. Fork the repository.
2. Create a new branch for your feature or bugfix.
3. Submit a pull request.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.

## Support

If you encounter any issues or have questions, feel free to open an issue on GitHub or contact me directly.

Enjoy your Star Citizen Patch Notes Discord Bot! 🚀
