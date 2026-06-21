const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 1. Discord Client Setup
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences
    ]
});

// Database file setup
const dbPath = path.join(__dirname, 'study.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Database connection error:', err);
    else console.log('Connected to the SQLite study database.');
});

// 2. Database Tables Initialization
db.serialize(() => {
    // Table for tracking total study time
    db.run(`CREATE TABLE IF NOT EXISTS study_time (
        user_id TEXT PRIMARY KEY,
        username TEXT,
        total_minutes INTEGER DEFAULT 0
    )`);

    // Table for to-do list items
    db.run(`CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        task TEXT,
        status TEXT DEFAULT 'pending'
    )`);
});

// Temporary memory to track active voice sessions
const activeSessions = new Map();

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    client.user.setActivity('students study!', { type: ActivityType.Watching });

    // 3. Idle Reminders (Runs every 30 minutes)
    setInterval(async () => {
        const guilds = client.guilds.cache;
        
        guilds.forEach(async (guild) => {
            try {
                const members = await guild.members.fetch({ withPresences: true });
                
                members.forEach(async (member) => {
                    if (member.user.bot) return;

                    // Check if online/idle/dnd but NOT in a voice channel
                    const isOnline = member.presence && ['online', 'idle', 'dnd'].includes(member.presence.status);
                    const inVC = member.voice.channelId;

                    if (isOnline && !inVC) {
                        try {
                            await member.send(`👋 Hey **${member.user.username}**! Padhai chal rahi hai ya bas break chal raha hai? Kuch productive karna hai toh fatafat Study Voice Channel join karo aur focus mode on karo! 📚🎯`);
                        } catch (dmErr) {
                            // Suppress error if user has DMs closed
                        }
                    }
                });
            } catch (err) {
                console.error('Error fetching members for reminders:', err);
            }
        });
    }, 30 * 60 * 1000); // 30 minutes loop
});

// 4. Voice Channel Study Tracking
client.on('voiceStateUpdate', async (oldState, newState) => {
    const userId = newState.id;
    const user = newState.member.user;

    if (user.bot) return;

    // Condition A: User Joins a Study VC (or transitions into one)
    if (!oldState.channelId && newState.channelId) {
        activeSessions.set(userId, Date.now());
    } 
    // Condition B: User Leaves the Study VC
    else if (oldState.channelId && !newState.channelId) {
        const joinTime = activeSessions.get(userId);
        if (joinTime) {
            const sessionDurationMs = Date.now() - joinTime;
            const sessionMinutes = Math.round(sessionDurationMs / (1000 * 60));
            activeSessions.delete(userId);

            if (sessionMinutes > 0) {
                // Update time in SQLite Database
                db.run(`INSERT INTO study_time (user_id, username, total_minutes) 
                        VALUES(?, ?, ?) 
                        ON CONFLICT(user_id) 
                        DO UPDATE SET total_minutes = total_minutes + ?, username = ?`,
                    [userId, user.username, sessionMinutes, sessionMinutes, user.username],
                    async (err) => {
                        if (err) return console.error(err.message);
                        
                        // Send private DM praising the user
                        try {
                            await user.send(`🎉 **Great Job!** Aapne abhi **${sessionMinutes} mins** ki solid study session poori ki hai. Konsa topic chal raha tha? Keep it up, proud of you! 🔥💪`);
                        } catch (dmErr) {
                            console.log(`Could not send DM to ${user.username}.`);
                        }
                    }
                );
            }
        }
    }
});

// 5. Commands Processing (!leaderboard, !todo, !studyplan)
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // --- LEADERBOARD COMMAND ---
    if (command === 'leaderboard') {
        db.all(`SELECT username, total_minutes FROM study_time ORDER BY total_minutes DESC LIMIT 10`, [], (err, rows) => {
            if (err) return message.channel.send("❌ Leaderboard fetch karne me dikkat aayi.");

            if (rows.length === 0) {
                return message.channel.send("📁 Leaderboard abhi khali hai! Phele log Voice Channel me baith kar padhna shuru karein.");
            }

            let description = "";
            const medals = ["🥇", "🥈", "🥉"];

            rows.forEach((row, index) => {
                const rankIcon = medals[index] || `🔹 **#${index + 1}**`;
                description += `${rankIcon} **${row.username}** — \`${row.total_minutes} mins\`\n`;
            });

            const embed = new EmbedBuilder()
                .setTitle('🏆 SERVER STUDY LEADERBOARD 🏆')
                .setDescription(description)
                .setColor('#00ffcc')
                .setTimestamp();

            message.channel.send({ embeds: [embed] });
        });
    }

    // --- TODO COMMANDS SYSTEM ---
    if (command === 'todo') {
        const subCommand = args[0]?.toLowerCase();
        const taskContent = args.slice(1).join(' ');

        if (!subCommand) {
            return message.reply("💡 **Kaise use karein:**\n`!todo add <kaam>` - Naya task add karein\n`!todo list` - Apni to-do list dekhein\n`!todo done <task_number>` - Task poora mark karein");
        }

        if (subCommand === 'add') {
            if (!taskContent) return message.reply("❌ Task kya hai? Yeh toh likho! Mudda: `!todo add Physics Chapter 1` ");
            
            db.run(`INSERT INTO todos (user_id, task) VALUES (?, ?)`, [message.author.id, taskContent], function(err) {
                if (err) return message.reply("❌ Task add nahi ho paya.");
                message.reply(`✅ Added to your list: "${taskContent}"`);
            });
        }

        else if (subCommand === 'list' || subCommand === 'show') {
            db.all(`SELECT id, task, status FROM todos WHERE user_id = ?`, [message.author.id], (err, rows) => {
                if (err) return message.reply("❌ List retrieve nahi ho payi.");
                if (rows.length === 0) return message.reply("🎉 Aapki To-Do list ekdam khali hai! Mauj lo.");

                let listMsg = `📋 **${message.author.username}'s To-Do List:**\n\n`;
                rows.forEach((row, index) => {
                    const statusIcon = row.status === 'completed' ? '✅ ~~' : '❌ ';
                    const endStrike = row.status === 'completed' ? '~~' : '';
                    listMsg += `**${index + 1}.** ${statusIcon}${row.task}${endStrike} *(ID: ${row.id})*\n`;
                });
                message.channel.send(listMsg);
            });
        }

        else if (subCommand === 'done') {
            const indexArg = parseInt(args[1]);
            if (isNaN(indexArg)) return message.reply("❌ Sahi list number dalo. Example: `!todo done 1` ");

            // Fetch user's tasks to map index to real DB ID
            db.all(`SELECT id FROM todos WHERE user_id = ?`, [message.author.id], (err, rows) => {
                if (err || rows.length === 0) return message.reply("❌ Koi task nahi mila.");
                
                const targetTask = rows[indexArg - 1];
                if (!targetTask) return message.reply("❌ Is number par koi task nahi mila.");

                db.run(`UPDATE todos SET status = 'completed' WHERE id = ?`, [targetTask.id], (err) => {
                    if (err) return message.reply("❌ Status update nahi ho paya.");
                    message.reply(`🎯 Badhiya! Task #${indexArg} successfully completed mark ho gaya.`);
                });
            });
        }
    }

    // --- STUDY PLAN GENERATOR COMMAND ---
    if (command === 'studyplan') {
        const topic = args.join(' ');
        if (!topic) return message.reply("❌ Kiske liye plan chahiye? Example dalo: `!studyplan Organic Chemistry` ya `!studyplan Physics Board Exam` ");

        const embed = new EmbedBuilder()
            .setTitle(`📚 3-DAY CRASH STUDY PLAN: ${topic.toUpperCase()}`)
            .setDescription(`Aapke exam/topic ke liye ek quick blueprint:`)
            .addFields(
                { name: '📅 Day 1: High-Weightage & Core Concepts', value: 'Concepts clear karo, notes read karo aur logic samjho. Aaj koi naya bhaari numerical mat uthao.' },
                { name: '📅 Day 2: Advanced Practice & Worksheets', value: 'Formulas revision ke sath complex numericals, naming reactions, aur back-exercises ko solve karo.' },
                { name: '📅 Day 3: PYQs & Speed Test', value: 'Pichle 5 saal ke questions lagao aur mock tests ko timed manner me attempt karo. Weak spots ko filter out karo.' }
            )
            .setColor('#ff9900')
            .setFooter({ text: 'Consistency is key. Mobile side me rakho aur lag jao! 🚀' });

        message.channel.send({ embeds: [embed] });
    }
});

// Safe Dummy Web Server for Cloud Deployment Hosting
const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Study Bot is running 24/7!'));
app.listen(process.env.PORT || 3000, () => console.log('Keep-alive dashboard ready.'));

// Login process utilizing Environment variables
client.login(process.env.TOKEN);
              
