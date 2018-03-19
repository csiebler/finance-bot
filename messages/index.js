"use strict";
var builder = require("botbuilder");
var azureBot = require("botbuilder-azure");
var azureStorage = require("azure-storage");
var path = require('path');

require('dotenv').config();

var storageName = process.env.STORAGE_ACCOUNT;
var storageKey = process.env.STORAGE_KEY;

var tableName = process.env.TABLE_NAME;
var expensesTableName = process.env.EXPENSES_TABLE_NAME;

var useEmulator = (process.env.NODE_ENV == 'development');

var tableClient = azureStorage.createTableService(storageName, storageKey);

// Connect bot
var connector = useEmulator ? new builder.ChatConnector() : new azureBot.BotServiceConnector({
    appId: process.env['MicrosoftAppId'],
    appPassword: process.env['MicrosoftAppPassword'],
    openIdMetadata: process.env['BotOpenIdMetadata']
});

// Setup bot persistency layer
var azureTableClient = new azureBot.AzureTableClient(tableName, storageName, storageKey);
var tableStorage = new azureBot.AzureBotStorage({ gzipData: false }, azureTableClient);

var bot = new builder.UniversalBot(connector);
bot.localePath(path.join(__dirname, './locale'));
bot.set('storage', tableStorage);
bot.set('persistUserData', true);

// Add first run dialog
bot.on('conversationUpdate', function (message) {
    if (message.membersAdded && message.membersAdded.length > 0) {
        message.membersAdded.forEach(function (identity) {
            if (identity.id === message.address.bot.id) {
                var welcomeMessage = new builder.Message()
                    .address(message.address)
                    .text("Hello, I'm your personal finance tracker bot!");
                bot.send(welcomeMessage);
                bot.beginDialog(message.address, '/')
            }
        });
    }
});

// Welcome back/query name dialog
bot.dialog('/', [
    function (session) {
        session.beginDialog('greeting');
    },
    function (session) {
        session.beginDialog('selectAction');
    }
]);

bot.dialog('greeting', [
    function (session) {
        var username = session.userData.userName;
        if (!username) {
            builder.Prompts.text(session, "What is your name?");
        } else {
            session.endDialog("Welcome back, %s", username);
        }
    },
    function (session, results) {
        if (results && results.response) {
            session.userData.userName = results.response;
            session.send("Welcome %s! I'll remember your name from now on!", session.userData.userName);
        }
        session.endDialog();
    }
]);

var options = {
    'Add expense': 'addExpense',
    'Show recent expenses': 'showExpenses',
    'Show monthly spend': 'showSpend'
};

var style = { listStyle: builder.ListStyle.button };

bot.dialog('selectAction', [
    function (session) {
        builder.Prompts.choice(session, "How can I help you?", Object.keys(options), style);
    },
    function (session, results) {
        var action = options[results.response.entity];
        return session.beginDialog(action);
    },
    function (session) {
        // keep going forever
        session.replaceDialog('selectAction');
    }
]);

bot.dialog('addExpense', [
    function (session) {
        builder.Prompts.text(session, "Ok, let's log an expense - where did you purchase something?");
    },
    function (session, results) {
        session.dialogData.vendor = results.response;
        builder.Prompts.number(session, "How much did you spend?");
    },
    function (session, results) {
        session.dialogData.price = results.response;
        var vendor = session.dialogData.vendor;
        var price = session.dialogData.price;
        var message = `You spent ${price} at ${vendor}, is this correct?`;
        builder.Prompts.choice(session, message, "Yes|No", style);
    }, function (session, results) {
        if (results.response.entity.match(/yes/i)) {
            var userId = session.message.user.id;
            var channelId = session.message.address.channelId;
            var vendor = session.dialogData.vendor;
            var price = session.dialogData.price;
            addExpenseToTable(userId, channelId, vendor, price);
            session.endDialog("Expenses added!");
        } else {
            session.endDialog("Discarded!");
        }
    }
]);

bot.dialog('showExpenses', [
    function (session) {
        var userId = session.message.user.id;
        var channelId = session.message.address.channelId;

        session.sendTyping();

        getLastExpensesFromTable(userId, channelId, function(e) {
            session.send(`Expense at ${e.vendor} for ${e.price}`);
        });

        setTimeout(function () {
            session.endDialog();
        }, 3000); 
    }
]);

bot.dialog('showSpend', [
    function (session) {
        session.endDialog("Your current spent in this month is $123");
    }
]);

if (useEmulator) {
    var restify = require('restify');
    var server = restify.createServer();
    server.listen(3978, function () {
        console.log('Bot up and running at http://localhost:3978/api/messages');
    });
    server.post('/api/messages', connector.listen());
} else {
    module.exports = connector.listen();
}

function addExpenseToTable(userId, channelId, vendor, price) {
    var entGen = azureStorage.TableUtilities.entityGenerator;
    var task = {
        PartitionKey: entGen.String(userId + '_' + channelId),
        RowKey: entGen.String(String(Date.now())),
        vendor: entGen.String(vendor),
        price: entGen.Int32(price)
    };

    tableClient.insertEntity(expensesTableName, task, function (error, result, response) {
        if (!error) {
            console.log("persisted expense to table");
        }
    });
};

function getLastExpensesFromTable(userId, channelId, action) {
    var query = new azureStorage.TableQuery()
        .select(['vendor', 'price', 'RowKey'])
        .top(5)
        .where('PartitionKey eq ?', userId + '_' + channelId);

    tableClient.queryEntities(expensesTableName, query, null, function (error, result, response) {
        if (!error) {
            result.entries.forEach(function(e){
                var item = {
                    price: e.price._,
                    vendor: e.vendor._,
                    ts: e.RowKey._
                };
                console.log("item: " + JSON.stringify(item));
                action(item);
            });

        } else {
            console.error("something went wrong! " + error);
        }
    });
};