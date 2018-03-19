"use strict";
var builder = require("botbuilder");
var azure = require("botbuilder-azure");
var path = require('path');

require('dotenv').config();

var tableName = process.env.TABLE_NAME;
var storageName = process.env.STORAGE_ACCOUNT;
var storageKey = process.env.STORAGE_KEY;
var useEmulator = (process.env.NODE_ENV == 'development');

var connector = useEmulator ? new builder.ChatConnector() : new azure.BotServiceConnector({
    appId: process.env['MicrosoftAppId'],
    appPassword: process.env['MicrosoftAppPassword'],
    openIdMetadata: process.env['BotOpenIdMetadata']
});

// Setup bot persistency layer
var azureTableClient = new azure.AzureTableClient(tableName, storageName, storageKey);
var tableStorage = new azure.AzureBotStorage({gzipData: false}, azureTableClient);

var bot = new builder.UniversalBot(connector);
bot.localePath(path.join(__dirname, './locale'));
bot.set('storage', tableStorage);

bot.dialog('/', function (session) {
    session.send('You said ' + session.message.text);
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
