const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const http = require('http');

// 1. RENDER BACKGROUND SERVER (Prevents Port Scan Timeout crashes)
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Mahiru Shiina Study Bot is actively running 24/7!\n');
}).listen(port, () => {
    console.log(`Web server successfully active on port ${port}`);
});

// 2. DISCORD CLIENT SETUP
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ]
});

// 3. SECURE JSON DATABASE SYSTEM
const DB_FILE = './study_data.json';
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, todos: {} }, null, 4));
}

function getData() {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveData(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 4));
}

// Memory Tracking Maps
const activeSessions = new Map();
const customTrackedChannels = new Map(); // Dynamic mapping for tracking custom created VCs

// 🛑 PUT YOUR MAIN PRE-DEFINED STUDY VOICE CHANNEL IDs HERE
const ALLOWED_VOICE_CHANNELS = [
    '123456789012345678' // Replace this string with your server's official main study VC ID
];

// Time Formatter Utility (e.g., 2h 7m or 39m)
function formatTime(totalMinutes) {
    if (totalMinutes < 60) return `${totalMinutes}m`;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

client.once('ready', () => {
    console.log(`🎉 Success! ${client.user.tag} is now fully deployed and active online.`);
});

// 4. COMMANDS HANDLER
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // A. REGISTER COMMAND (Unlocks DM Channels for Users)
    if (message.content === '!register') {
        const db = getData();
        if (!db.users[message.author.id]) {
            db.users[message.author.id] = { total_time: 0, username: message.author.username };
            saveData(db);
        }

        const welcomeEmbed = new EmbedBuilder()
            .setTitle("🔒 DM Pipeline Activated Successfully!")
            .setDescription(
                `Hello! I am your study manager. From now on, your DM pipeline is unlocked.\n\n` +
                `**What I will do:**\n` +
                `• Track every single minute of your study session.\n` +
                `• Send precise session summaries with your total credits.\n` +
                `• Absolute surveillance: I will scold you mercilessly if you have pending tasks or dare to fall behind your server rivals.`
            )
            .setColor("#3498db");

        message.author.send({ embeds: [welcomeEmbed] })
            .then(() => message.reply("⚙️ Pipeline registration complete! Check your DMs—I've opened our communications link."))
            .catch(() => message.reply("❌ Error: I tried to send a DM but failed. Please adjust your **Privacy Settings** for this server to allow direct messages, then try `!register` again."));
        return;
    }

    // B. CUSTOM VC ON-DEMAND TRACKING
    if (message.content === '!track') {
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) {
            return message.reply("❌ Sit down in your custom voice channel first, then call this command!");
        }

        // Add to temporary watchlist map
        customTrackedChannels.set(voiceChannel.id, message.guild.id);
        
        // Start tracking immediately upon running the command
        activeSessions.set(message.author.id, Date.now());

        return message.reply(`✅ **On-Demand Tracking Initialized!** I am now actively tracking sessions in the custom channel: **${voiceChannel.name}**.`);
    }

    // C. TODO: ADD TASKS
    if (message.content.startsWith('!todo add ')) {
        const task = message.content.replace('!todo add ', '').trim();
        if (!task) return message.reply("Write down an actual task name!");

        const db = getData();
        if (!db.todos[message.author.id]) db.todos[message.author.id] = [];
        db.todos[message.author.id].push({ task, done: false });
        saveData(db);
        
        message.reply(`📝 Added task: "${task}". Do not look for excuses, get it done!`);
    }

    // D. TODO: LIST AND MERCILESS SCOLDING
    if (message.content === '!todo list') {
        const db = getData();
        const userTodos = db.todos[message.author.id] || [];
        const pendingTasks = userTodos.filter(t => !t.done);

        if (userTodos.length === 0) {
            return message.reply("Your to-do list is empty. Are you even setting goals? Go add some tasks using `!todo add <task>` right now.");
        }

        let listText = "";
        userTodos.forEach((t, i) => {
            listText += `${i + 1}. ${t.done ? '~~' + t.task + '~~ 🟩 (Done)' : t.task + ' 🟥 (PENDING)'}\n`;
        });

        if (pendingTasks.length > 0) {
            return message.reply(
                `😡 **You have ${pendingTasks.length} pending tasks left!**\n\n` +
                `${listText}\n` +
                `Are you kidding me right now? Slacking off is completely unacceptable. Put your head down and work immediately!`
            );
        } else {
            return message.reply(`📋 **Your To-Do List:**\n\n${listText}\nWow, clean slate. Go add more tasks or stay focused in your channels.`);
        }
    }

    // E. TODO: COMPLETE TASK
    if (message.content.startsWith('!todo done ')) {
        const index = parseInt(message.content.replace('!todo done ', '')) - 1;
        const db = getData();
        const userTodos = db.todos[message.author.id] || [];

        if (isNaN(index) || index < 0 || index >= userTodos.length) {
            return message.reply("Provide a valid list index number!");
        }

        userTodos[index].done = true;
        saveData(db);
        message.reply(`🎉 Finally, a little progress! Task marked completed: **${userTodos[index].task}**.`);
    }

    // F. LEADERBOARD DISPLAY
    if (message.content === '!leaderboard') {
        const db = getData();
        const sortedUsers = Object.entries(db.users).sort((a, b) => b[1].total_time - a[1].total_time).slice(0, 10);

        if (sortedUsers.length === 0) {
            return message.reply("Nobody has logged any hours today. Be the first to start studying!");
        }

        let leaderboardString = "";
        sortedUsers.forEach((user, index) => {
            leaderboardString += `**#${index + 1}** ${user[1].username} — \`${formatTime(user[1].total_time)}\` total\n`;
        });

        const leaderboardEmbed = new EmbedBuilder()
            .setTitle("🏆 Today's Study Leaderboard 🏆")
            .setDescription(leaderboardString)
            .setColor("#2ecc71")
            .setTimestamp();

        message.channel.send({ embeds: [leaderboardEmbed] });
    }
});

// 5. VOICE EVENTS (Tracking, Credits, Rival Comparison & Aggressive DM Scolding)
client.on('voiceStateUpdate', (oldState, newState) => {
    const userId = newState.id;
    const oldChannel = oldState.channelId;
    const newChannel = newState.channelId;

    // Verification Logic: Main channels vs dynamically tracked custom channels
    const isChannelTracked = (channelId) => {
        return ALLOWED_VOICE_CHANNELS.includes(channelId) || customTrackedChannels.has(channelId);
    };

    // User Joins a Valid Tracked Voice Channel
    if (!oldChannel && newChannel && isChannelTracked(newChannel)) {
        activeSessions.set(userId, Date.now());
    }

    // User Leaves or Changes out of a Valid Tracked Voice Channel
    if (oldChannel && isChannelTracked(oldChannel) && oldChannel !== newChannel) {
        const startTime = activeSessions.get(userId);
        
        if (startTime) {
            const durationMs = Date.now() - startTime;
            const minutesStudied = Math.floor(durationMs / 60000);
            activeSessions.delete(userId);

            // 1-minute guard to ensure valid text configurations are met
            if (minutesStudied >= 1) {
                const db = getData();
                
                if (!db.users[userId]) {
                    db.users[userId] = { total_time: 0, username: newState.member.user.username };
                }
                db.users[userId].total_time += minutesStudied;
                db.users[userId].username = newState.member.user.username; // Updates display name dynamically
                saveData(db);

                const creditsCalculated = (minutesStudied * 1.70615).toFixed(2);
                const sessionFormatted = formatTime(minutesStudied);

                // --- 📊 COMPETITOR COMPARISON LOGIC ---
                const sortedRivals = Object.entries(db.users).sort((a, b) => b[1].total_time - a[1].total_time);
                const topRivalId = sortedRivals[0][0];
                const topRivalName = sortedRivals[0][1].username;
                const topRivalTime = sortedRivals[0][1].total_time;
                const userCurrentTotal = db.users[userId].total_time;

                let comparisonContext = "";
                if (topRivalId === userId) {
                    comparisonContext = `👑 **Incredible work! You are currently the #1 top studier in the server! Keep pushing to secure your throne.**`;
                } else {
                    const timeDifference = topRivalTime - userCurrentTotal;
                    comparisonContext = `⚠️ **Rival Alert:** The top studier right now is **${topRivalName}**, who is **${formatTime(timeDifference > 0 ? timeDifference : 0)}** ahead of you. Get back into the trenches and overtake them! 🔥`;
                }

                // --- 😡 AGGRESSIVE TODO LIST SCOLDING LOGIC ---
                const userTodos = db.todos[userId] || [];
                const pendingCount = userTodos.filter(t => !t.done).length;
                
                let scoldSection = "";
                if (pendingCount > 0) {
                    scoldSection = `😡 **WHY ARE YOU LEAVING?! You still have ${pendingCount} pending tasks remaining on your list! Slacking off is not an option. Go finish them immediately!**`;
                } else {
                    scoldSection = `✨ Splendid job! Your to-do list is completely cleared. Keep maintaining this magnificent work ethic.`;
                }

                // Build Final Mahiru Style DM Payload
                const summaryPayload = `🎉 **Session Completed!**\n\n` +
                    `⏱️ **Time Studied:** ${sessionFormatted}\n` +
                    `💰 **Credits Earned:** ${creditsCalculated}\n\n` +
                    `Great job staying focused! Consistency is key. Every minute counts toward your goals! 📚💪\n\n` +
                    `--- \n\n` +
                    `${comparisonContext}\n\n` +
                    `${scoldSection}`;

                newState.member.send(summaryPayload)
                    .catch(() => console.log(`DM delivery failed. User ${newState.member.user.tag} might have communications locked.`));
            }
        }
    }
});

client.login(process.env.TOKEN);
                           
        
