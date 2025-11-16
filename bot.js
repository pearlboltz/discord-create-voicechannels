const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits, SlashCommandBuilder, REST, Routes } = require('discord.js');

const CONFIG = {
    TOKEN: 'ваш-токен-бота',
    TRIGGER_CHANNEL_ID: 'id-канала',
    CLIENT_ID: 'id-клиента',
    GUILD_ID: 'id-сервера',
};

const createdRooms = new Map();
const pingCooldowns = new Map();
const PING_COOLDOWN = 30000;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
    ]
});

client.once('ready', async () => {
    console.log(`Бот запущен как ${client.user.tag}`);
    console.log(`Ожидание подключений к каналу...`);
    
	const activities = [
		{ name: "⚙️ /help | v1.1", type: 0 },
        { name: "👀 Слежу за комнатами", type: 0 },
        { name: "🎧 Слушаю людей в каналах", type: 0 },
    ];
	
	let i = 0;
	
	setInterval(() => {
        client.user.setPresence({
            activities: [activities[i]],
            status: "online"
        });

        i = (i + 1) % activities.length;
    }, 15000);
	
    await registerCommands();
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
        if (newState.channelId === CONFIG.TRIGGER_CHANNEL_ID && oldState.channelId !== newState.channelId) {
            await handleRoomCreation(newState);
        }

        if (oldState.channelId && createdRooms.has(oldState.channelId)) {
            await handleRoomDeletion(oldState);
        }
    } catch (error) {
        console.error('Ошибка при обработке голосового состояния:', error);
    }
});

async function handleRoomCreation(voiceState) {
    const { member, guild } = voiceState;
    const triggerChannel = guild.channels.cache.get(CONFIG.TRIGGER_CHANNEL_ID);

    if (!triggerChannel) {
        console.error('Канал "Create room" не найден! Проверьте TRIGGER_CHANNEL_ID в конфигурации.');
        return;
    }

    const roomName = `${member.user.username}'s room`;

    console.log(`Создание комнаты для ${member.user.username}...`);

    const newChannel = await guild.channels.create({
        name: roomName,
        type: ChannelType.GuildVoice,
        parent: triggerChannel.parentId,
        permissionOverwrites: [
            {
                id: guild.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
            },
            {
                id: member.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.Connect,
                    PermissionFlagsBits.ManageChannels,
                    PermissionFlagsBits.MoveMembers,
                ],
            },
        ],
    });

    createdRooms.set(newChannel.id, member.id);

    await member.voice.setChannel(newChannel);

    console.log(`Комната "${roomName}" создана и пользователь перемещен`);
}

async function handleRoomDeletion(voiceState) {
    const { channelId, guild } = voiceState;

    if (!createdRooms.has(channelId)) {
        return;
    }
    
    try {
        const channel = guild.channels.cache.get(channelId);
        
        if (!channel) {
            createdRooms.delete(channelId);
            return;
        }

        if (channel.members.size === 0) {
            console.log(`Удаление пустой комнаты "${channel.name}"...`);
            
            createdRooms.delete(channelId);
            
            await channel.delete();
            
            console.log(`Комната удалена`);
        }
    } catch (error) {
        if (error.code === 10003) {
            createdRooms.delete(channelId);
            return;
        }
        
        console.error(`Ошибка при удалении канала:`, error.message);
        createdRooms.delete(channelId);
    }
}

client.on('error', error => {
    console.error('Ошибка клиента Discord:', error);
});

process.on('unhandledRejection', error => {
    console.error('Необработанная ошибка:', error);
});

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);

    const commands = [
        new SlashCommandBuilder()
            .setName('ping')
            .setDescription('Пригласить пользователя в вашу голосовую комнату')
            .addUserOption(option =>
                option
                    .setName('user')
                    .setDescription('Пользователь, которого нужно пригласить')
                    .setRequired(true)
            )
            .addIntegerOption(option =>
                option
                    .setName('amount')
                    .setDescription('Количество приглашений (1-10)')
                    .setMinValue(1)
                    .setMaxValue(10)
            ),
        new SlashCommandBuilder()
            .setName('help')
            .setDescription('Показать список команд и информацию о боте')
    ].map(cmd => cmd.toJSON());

    try {
        console.log('Удаляю глобальные команды (во избежание дублей)...');

        await rest.put(
            Routes.applicationCommands(CONFIG.CLIENT_ID),
            { body: [] }
        );

        console.log('Глобальные команды удалены.');

        console.log('Регистрирую команды для сервера...');

        await rest.put(
            Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID),
            { body: commands }
        );

        console.log('Команды зарегистрированы для сервера:');
        commands.forEach(c => console.log(`/${c.name} — ${c.description}`));

    } catch (error) {
        console.error('Ошибка при регистрации команд:', error);
    }
}


client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ping') {
        await handlePingCommand(interaction);
    } else if (interaction.commandName === 'help') {
        await handleHelpCommand(interaction);
    }
});

async function handlePingCommand(interaction) {
    const targetUser = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount') || 1;
    const sender = interaction.user;

    const now = Date.now();
    const cooldownEnd = pingCooldowns.get(sender.id);
    
    if (cooldownEnd && now < cooldownEnd) {
        const timeLeft = Math.ceil((cooldownEnd - now) / 1000);
        return interaction.reply({
            content: `Подождите ${timeLeft} секунд перед следующим использованием команды!`,
            ephemeral: true
        });
    }

    const member = interaction.guild.members.cache.get(sender.id);
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
        return interaction.reply({
            content: 'Вы должны находиться в голосовом канале, чтобы использовать эту команду!',
            ephemeral: true
        });
    }

    const isOwnRoom = createdRooms.get(voiceChannel.id) === sender.id;

    if (!isOwnRoom) {
        return interaction.reply({
            content: 'Вы можете приглашать пользователей только из своей созданной комнаты!',
            ephemeral: true
        });
    }

    if (targetUser.id === sender.id) {
        return interaction.reply({
            content: 'Вы не можете пригласить самого себя!',
            ephemeral: true
        });
    }

    const targetMember = interaction.guild.members.cache.get(targetUser.id);
    if (targetMember?.voice?.channelId === voiceChannel.id) {
        return interaction.reply({
            content: 'Этот пользователь уже находится в вашей комнате!',
            ephemeral: true
        });
    }

    try {
        await interaction.deferReply({ ephemeral: true });

        let successCount = 0;
        
        for (let i = 0; i < amount; i++) {
            try {
                await targetUser.send(
                    `📢 **${targetUser.username}**, вас зовёт **${sender.username}** в комнату **${voiceChannel.name}**!`
                );
                successCount++;
                
                if (i < amount - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } catch (error) {
                console.error(`Ошибка при отправке сообщения:`, error);
                break;
            }
        }

        pingCooldowns.set(sender.id, now + PING_COOLDOWN);
        setTimeout(() => pingCooldowns.delete(sender.id), PING_COOLDOWN);

        if (successCount > 0) {
            await interaction.editReply({
                content: `Отправлено ${successCount} приглашени${successCount === 1 ? 'е' : 'й'} пользователю **${targetUser.username}**!`
            });
        } else {
            await interaction.editReply({
                content: `Не удалось отправить приглашение. Возможно, у пользователя закрыты личные сообщения.`
            });
        }
    } catch (error) {
        console.error('Ошибка при обработке команды ping:', error);
        await interaction.editReply({
            content: 'Произошла ошибка при отправке приглашения.'
        });
    }
}

async function handleHelpCommand(interaction) {
    const embed = {
        title: 'Помощь по командам бота',
        description: 'Бот для создания временных голосовых каналов',
        fields: [
            {
                name: 'Как создать комнату?',
                value: '1. Зайдите в голосовой канал **"[+] Create a room"**\n2. Бот автоматически создаст вашу личную комнату\n3. Вы будете перемещены в неё\n4. Когда все выйдут - комната удалится автоматически',
                inline: false
            },
            {
                name: 'Доступные команды',
                value: '・ `/ping @пользователь [количество]` - Пригласить пользователя в вашу комнату\n・ `/help` - Показать это сообщение',
                inline: false
            },
            {
                name: 'Команда /ping',
                value: '**Использование:** `/ping @пользователь 5`\n**Описание:** Отправляет приглашение в личные сообщения пользователя\n**Ограничения:** \n・ Работает только в вашей созданной комнате\n・ Максимум 10 приглашений за раз\n・ Кулдаун 30 секунд',
                inline: false
            },
            {
                name: 'Права владельца комнаты',
                value: '・ Управление каналом (переименование, лимит и т.д.)\n・ Перемещение участников\n・ Приглашение пользователей через `/ping`',
                inline: false
            }
        ],
        timestamp: new Date().toISOString()
    };

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

client.login(CONFIG.TOKEN);