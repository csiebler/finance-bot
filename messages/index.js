"use strict";
var builder = require("botbuilder");
var azure = require("botbuilder-azure");
var path = require('path');

require('dotenv').config();

var tableName = process.env.TABLE_NAME;
var storageName = process.env.STORAGE_ACCOUNT;
var storageKey = process.env.STORAGE_KEY;
var useEmulator = (process.env.NODE_ENV == 'development');

// Connect bot
var connector = useEmulator ? new builder.ChatConnector() : new azure.BotServiceConnector({
    appId: process.env['MicrosoftAppId'],
    appPassword: process.env['MicrosoftAppPassword'],
    openIdMetadata: process.env['BotOpenIdMetadata']
});

// Setup bot persistency layer
var azureTableClient = new azure.AzureTableClient(tableName, storageName, storageKey);
var tableStorage = new azure.AzureBotStorage({gzipData: false}, azureTableClient);

var bot = new builder.UniversalBot(connector, '/');
bot.localePath(path.join(__dirname, './locale'));
bot.set('storage', tableStorage);
bot.set('persistUserData', true);

    /*
    userData, privateConversationData, and conversationData persisted after session ends
    session.userData --> Saved for channel across conversations
    session.privateConversationData --> Saved for channel and conversation only
    session.conversationData --> saved in context of cur conversation but shared with all users in grp
    session.dialogData --> removed once dialog ends
    */

// Add first run dialog
bot.on('conversationUpdate', function (message) {
    if (message.membersAdded && message.membersAdded.length > 0) {
        message.membersAdded.forEach(function (identity) {
            if (identity.id === message.address.bot.id) {
                var welcomeMessage = new builder.Message()
                    .address(message.address)
                    .text("Hello, I'm your personal finance tracker bot! How are you?");
                bot.send(welcomeMessage);
            }
        });
    }
});

// Welcome back/query name dialog
bot.dialog('/', [
    function(session) {
        var username = session.userData.userName;
        if (!username) {
            builder.Prompts.text(session, "What is your name?");
        } else {
            session.send("Welcome back, %s", username);
        }
    },
    function(session, results) {
        if (results && results.response) {
            session.userData.userName = results.response;
            session.send("Welcome %s! I'll remember your name from now on!", session.userData.userName);
        }
        session.beginDialog('/echo');
    }
]);

// Basic echo dialog, keeps going forever
bot.dialog('/echo', function(session) {
    var username = session.userData.userName;
    session.send("Thanks %s, you said: %s", username, session.message.text)
});


if (useEmulator) {
    var restify = require('restify');
    var server = restify.createServer();
    server.listen(3978, function() {
        console.log('Bot up and running at http://localhost:3978/api/messages');
    });
    server.post('/api/messages', connector.listen());    
} else {
    module.exports = connector.listen();
}
