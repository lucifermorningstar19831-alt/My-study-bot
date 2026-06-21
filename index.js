const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const http = require('http');

// 1. DUMMY SERVER FOR RENDER (Fixes Port Scan Timeout)
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Study Bot is running perfectly 24/7!\n');
}).listen(port, () => {
    console.log(`Web server listening on port ${port}`);
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

// 3. SAFE JSON DATABASE SYSTEM
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

// Active Sessions map aur Custom VC Tracking Map
const activeSessions = new Map();
const customTrackedChannels = new Map(); // Map<ChannelId, GuildId> ke liye temporary storage

// 🛑 APNI MAIN STUDY VOICE CHANNELS KI IDS YAHAN DAALO
const ALLOWED_VOICE_CHANNELS = [
    '123456789012345678' // Apne main study channel ki ID yahan paste karein
];

// Helper to format time nicely (e.g., 2h 7m or 39m)
function formatTime(totalMinutes) {
    if (totalMinutes < 60) return `${totalMinutes}m`;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

client.once('ready', () => {
    console.log(`🎉 Bot is online as ${client.user.tag}!`);
    
    // IDLE REMINDERS LOOP (Har 30 Minutes mein chalega)
    setInterval(() => {
        const db = getData();
        const sortedUsers = Object.entries(db.users).sort((a, b) => b[1].total_time - a[1].total_time);
        const topStudierTime = sortedUsers[0] ? sortedUsers[0][1].total_time : 0;

        let top5Leaderboard = "";
        const medals = ["🥇", "🥈", "🥉", "#4", "#5"];
        sortedUsers.slice(0, 5).forEach((user, index) => {
            top5Leaderboard += `${medals[index]} **${user[1].username}** — ${formatTime(user[1].total_time)}\n`;
        });
        if (!top5Leaderboard) top5Leaderboard = "No active sessions today.";

        client.guilds.cache.forEach(guild => {
            guild.members.cache.forEach(member => {
                if (member.user.bot) return;
                
                const isOnline = member.presence?.status === 'online' || member.presence?.status === 'idle';
                const isInVC = member.voice.channelId !== null;
                
                if (isOnline && !isInVC) {
                    const userData = db.users[member.id] || { total_time: 0 };
                    const userTodayTime = userData.total_time;
                    const timeBehind = topStudierTime - userTodayTime;

                    const reminderText = `😤 **${client.user.username} here.**\n\n` +
                        `It's been over **6 hours** since you last studied. Get back in the VC — slacking is not an option. 📚\n\n` +
                        `📉 You've studied **${formatTime(userTodayTime)}** today.\n` +
                        `The top studier is **${formatTime(timeBehind > 0 ? timeBehind : 0)}** ahead of you. Get back in! 🔥\n\n` +
                        `📊 **Today's Study Leaderboard (Top 5):**\n${top5Leaderboard}\n` +
                        `*Don't make me ask again.*`;

                    member.send(reminderText).catch(() => console.log(`Could not DM ${member.user.tag}`));
                }
            });
        });
    }, 30 * 60 * 1000);
});

// VOICE STATE UPDATE (Tracking & Clean Summary DMs)
client.on('voiceStateUpdate', (oldState, newState) => {
    const userId = newState.id;
    const oldChannel = oldState.channelId;
    const newChannel = newState.channelId;

    // Check karega ki kya channel main list mein hai ya custom track kiya gaya hai
    const isChannelTracked = (channelId) => {
        return ALLOWED_VOICE_CHANNELS.includes(channelId) || customTrackedChannels.has(channelId);
    };

    // User Joins a Tracked VC
    if (!oldChannel && newChannel && isChannelTracked(newChannel)) {
        activeSessions.set(userId, Date.now());
    }

    // User Leaves or Switches from a Tracked VC
    if (oldChannel && isChannelTracked(oldChannel) && oldChannel !== newChannel) {
        const startTime = activeSessions.get(userId);
        if (startTime) {
            const sessionDurationMs = Date.now() - startTime;
            const sessionMinutes = Math.floor(sessionDurationMs / 60000);
            activeSessions.delete(userId);

            if (sessionMinutes >= 1) { // 1 min minimum filter for clean test
                const db = getData();
                if (!db.users[userId]) db.users[userId] = { total_time: 0, username: newState.member.user.username };
                db.users[userId].total_time += sessionMinutes;
                saveData(db);

                const creditsEarned = (sessionMinutes * 1.70615).toFixed(2);
                const formattedSessionTime = formatTime(sessionMinutes);

                const sessionSummaryText = `🎉 **Session Completed!**\n\n` +
                    `⏱️ **Time Studied:** ${formattedSessionTime}\n` +
                    `💰 **Credits Earned:** ${creditsEarned}\n\n` +
                    `Great job staying focused! Consistency is key. Every minute counts toward your goals! 📚💪`;

                newState.member.send(sessionSummaryText).catch(() => console.log(`Could not send DM`));
            }
        }
    }
});

// COMMANDS HANDLER
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // 1. CUSTOM VC TRACKING COMMAND
    if (message.content === '!track') {
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) {
            return message.reply("❌ Bhai, pehle kisi custom Voice Channel mein jaakar baitho, fir yeh command chalao!");
        }

        // Custom channel ko list mein save karlo
        customTrackedChannels.set(voiceChannel.id, message.guild.id);
        
        // Agar bande ne pehle se join kiya hua hai, toh session abhi se count hona shuru ho jaye
        activeSessions.set(message.author.id, Date.now());

        return message.reply(`✅ **Tracking Started!** Ab aapke is custom VC (${voiceChannel.name}) mein baithne ka time track ho raha hai.`);
    }

    // 2. LEADERBOARD
    if (message.content === '!leaderboard') {
        const db = getData();
        const sortedUsers = Object.entries(db.users).sort((a, b) => b[1].total_time - a[1].total_time).slice(0, 10);

        if (sortedUsers.length === 0) return message.reply("Abhi tak kisi ne padhai shuru nahi ki hai!");

        let description = "";
        sortedUsers.forEach((user, index) => {
            description += `**#${index + 1}** <@${user[0]}> - \`${formatTime(user[1].total_time)}\`\n`;
        });

        const embed = new EmbedBuilder()
            .setTitle("📚 Study Leaderboard 🏆")
            .setDescription(description)
            .setColor("#00ff00")
            .setTimestamp();

        message.channel.send({ embeds: [embed] });
    }

    // 3. TODO ADD
    if (message.content.startsWith('!todo add ')) {
        const task = message.content.replace('!todo add ', '').trim();
        if (!task) return message.reply("Task toh likho bhai!");

        const db = getData();
        if (!db.todos[message.author.id]) db.todos[message.author.id] = [];
        db.todos[message.author.id].push({ task, done: false });
        saveData(db);
        message.reply(`✅ Task added: "${task}"`);
    }

    // 4. TODO LIST
    if (message.content === '!todo list') {
        const db = getData();
        const userTodos = db.todos[message.author.id] || [];
        if (userTodos.length === 0) return message.reply("Aapki to-do list abhi khaali hai!");

        let listText = "";
        userTodos.forEach((t, i) => {
            listText += `${i + 1}. ${t.done ? '~~' + t.task + '~~ 🟩' : t.task + ' 🟥'}\n`;
        });
        message.reply(`📋 **Aapki To-Do List:**\n${listText}\n*Khatam karne ke liye likhein \`!todo done <number>\`*`);
    }

    // 5. TODO DONE
    if (message.content.startsWith('!todo done ')) {
        const index = parseInt(message.content.replace('!todo done ', '')) - 1;
        const db = getData();
        const userTodos = db.todos[message.author.id] || [];

        if (isNaN(index) || index < 0 || index >= userTodos.length) return message.reply("Sahi list number daalo bhai!");

        userTodos[index].done = true;
        saveData(db);
        message.reply(`🎉 Mast! Task completed: **${userTodos[index].task}**`);
    }
});

client.login(process.env.TOKEN);

              
