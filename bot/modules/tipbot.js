"use strict";

const config = require("config");
const config_bot = config.get("bot");
const bitcoin = require("bitcoin");
const power = new bitcoin.Client(config.get("power"));
const mongoose = require("mongoose");
const syncRequest = require("sync-request");

mongoose.Promise = global.Promise;
const mongodb = config.get("mongodb");
mongoose.connect(mongodb.url, mongodb.options);
const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error: "));
db.once("open", function () {
    console.log("Mongodb: connected to '" + this.host + "/" + this.name + "'!");
});

const userSchema = mongoose.Schema({
    "discordID": String,
    "address": String,
    "spent": Number,
    "received": Number
});
const User = mongoose.model("User", userSchema);

exports.commands = [
    "tip"
];

exports.tip = {
    usage: "<subcommand>",

    description: "Here is the commands you can use:\n"
    + "**Use at your own risk. The developer of this bot assumes no responsibility for any lost coins**"
    + "**!tip help** : display this message.\n"
    + "**!tip deposit** : get an address to top up your balance.\n"
    + "**!tip balance** : get your balance.\n"
    + "**!tip withdraw <amount> <address>** : withdraw <amount> PWRs from your"
    + " balance to your <address>.\n"
    + "**!tip <@user> <amount> [message]** : tip <@user> <amount> PWRs (MAX tip is 50000000)"
    + " and leave an optional [message].\n"
    + "**!tip each <amount> <n> [message]** : drop a packet in a channel, the"
    + " <amount> is divided *equally* between the <n> first people to open"
    + " the packet. Leave an optionnal [message] with the packet.\n"
    + "**!tip luck <amount> <n> [message]** : drop a packet in a channel, the"
    + " <amount> is divided *randomly* between the <n> first people to open"
    + " the packet. Leave an optionnal [message] with the packet.\n"
    + "**!tip open** : open the latest packet dropped into the channel.\n",

    process: async function (bot, msg) {
        getUser(msg.author.id, function (err, doc) {
            if (err) return console.error(err);

            const tipper = doc;
            const words = msg.content.trim().split(" ").filter(
                function (n) {
                    return n !== "";
                }
            );
            const subcommand = words.length >= 2 ? words[1] : "help";

            switch (subcommand) {
                case "help":
                    doHelp(msg);
                    break;

                case "balance":
                    doBalance(msg, tipper);
                    break;

                case "deposit":
                    doDeposit(msg, tipper);
                    break;

                case "withdraw":
                    doWithdraw(msg, tipper, words);
                    break;

                case "each":
                    createTipEach(msg, tipper, words);
                    break;

                case "luck":
                    createTipLuck(msg, tipper, words);
                    break;

                case "open":
                    doOpenTip(msg, tipper, words, bot);
                    break;

                default:
                    doTip(msg, tipper, words, bot);
            }
        });
    }
};

let tipAllChannels = [];
const allowedFiatCurrencySymbols = ["USD", "EUR", "RUB", "JPY", "GBP", "AUD", "BRL", "CAD", "CHF", "CLP", "CNY", "CZK",
    "DKK", "HKD", "IDR", "ILS", "INR", "KRW", "MXN", "MYR", "NOK", "NZD", "PHP", "PKR", "PLN", "SEK", "SGD", "THB",
    "TRY", "TWD", "ZAR"];

/**
 * @param message
 */
function doHelp(message) {
    if (message.channel.type !== "dm") {
        return message.reply("send me this command in direct message!").then(message => message.delete(10000));
    }

    message.author.send(
        "**Use at your own risk. The developer of this bot assumes no responsibility for any lost coins**"
        + "Here are the commands you can use:\n"
        + "**!tip help** : display this message.\n\n"
        + "**!tip deposit** : get an address to top up your balance. `Warning:` Mining directly into your `tip-bot-address` is prohibited (You won't be able to use these PWRs)! And no support for retrieving these PWRs will be provided!\n\n"
        + "**!tip balance** : get your balance.\n\n"
        + "**!tip withdraw <amount> <address>** : withdraw <amount> PWRs from your balance to your <address>.\n\n"
        + "**!tip luck <amount> <n> [message]** : drop a packet in a channel, the <amount> is divided *randomly* (one tip is bigger, you can win jackpot) between the <n> first people to open the packet. Leave an optionnal [message] with the packet. Only one packet per channel is allowed. Maximum is 100 people. Your packet will be active for next 5 minutes, then can be overwritten. Maximum tip has to be ≤ 50000000 PWR.\n\n"
        + "**!tip each <amount> <n> [message]** : drop a packet in a channel, the <amount> is divided *equally* between the <n> first people to open the packet. Leave an optionnal [message] with the packet. Only one packet per channel is allowed. Maximum is 100 people. Your packet will be active for next 5 minutes, then can be overwritten. Maximum tip has to be ≤ 50000000 PWR.\n\n"
        + "**!tip <@user> <amount> [message]** : tip <@user> <amount> PWRs.\n\n"
        //+ "**!tip <@user> random [message]** : tip <@user> random PWRs where random is <0.0, 0.1)\n\n"
      //  + "**!tip <@user> <amount><fiat_currency_ticker> [message]** : tip <@user> PWRs in fiat equivalent. Example: **!tip @freakcoder 10000usd**. You can use <fiat_currency_ticker> with every command. Where <fiat_currency_ticker> can be: USD, EUR, RUB, JPY, GBP, AUD, BRL, CAD, CHF, CLP, CNY, CZK, DKK, HKD, IDR, ILS, INR, KRW, MXN, MYR, NOK, NZD, PHP, PKR, PLN, SEK, SGD, THB, TRY, TWD, ZAR\n"
    );
}

/**
 * @param id
 * @param cb
 */
function getUser(id, cb) {
    //  default user
    const user = new User({
        discordID: id,
        address: "",
        spent: 0,
        received: 0
    });

    // look for user in DB
    User.findOne({"discordID": id}, function (err, doc) {
        if (err) {
            return cb(err, null);
        }

        if (doc) {
            // Existing User
            cb(null, doc);
        } else {
            // New User
            power.getAddressesByAccount(function (err, address) {
                if (err) {
                    return cb(err, null);
                }
                user.address = address;
                user.save(function (err) {
                    if (err) {
                        cb(err, null);
                    }
                    cb(null, user);
                });
            });
        }
    });
}

/**
 * Calculate and return user's balance. DO NOT CONFUSE WITH doBalance!
 * @param tipper
 * @param cb
 */
function getBalance(tipper, cb) {
    // tipper has no address, never made a deposit
    if (!tipper.address) {
        return cb(null, tipper.received - tipper.spent);
    }

    // balance = total deposit amount + total received - total spent
    power.cmd("getreceivedbyaddress", tipper.address, function (err, amount) {
        if (err) {
            return cb(err, null);
        }

        const balance = amount + tipper.received - tipper.spent;
        return cb(null, balance);
    });
}

/**
 * Reply to !tip balance and display user's balance. DO NOT CONFUSE WITH getBalance!
 * @param message
 * @param tipper
 */
function doBalance(message, tipper) {
    if (message.channel.type !== "dm") {
        return message.reply("You want people seeing your balance? Send this *$%@ in a DM!").then(message => message.delete(10000));
    }

    getBalance(tipper, function (err, balance) {
        if (err) {
            return message.reply("error getting balance!");
        }

        message.reply("You have **" + balance + "** PWR");
    });
}

/**
 * @param message
 * @param tipper
 */
function doDeposit(message, tipper) {
    if (message.channel.type !== "dm") {
        return message.reply("If you want to send me money, I will tell you where to send it privately....in a DM").then(message => message.delete(10000));
    }

    if (tipper.address) {
        // tipper already has a deposit address
        message.reply("Your deposit address is: " + tipper.address
                     + "https://blockexplorer.pwr-coin.com/qr/" + tipper.address
                     );
    } else {
        // tipper has no deposit address yet, generate a new one
        power.getAddressesByAccount(function (err, address) {
            if (err) {
                return message.reply("Error getting deposit address!");
            }

            User.update(
                {discordID: tipper.discordID},
                {"$set": {address: address}},
                function (err, raw) {
                    if (err) {
                        console.error(err);
                    } else {
                        console.log(raw);
                        message.reply("Your deposit address is: " + address);
                    }
                }
            );
        });
    }
}

/**
 * Calculate equivalent of PWR in given currency.
 * @param amount - float - given in specific currency
 * @param fiatCurrencySymbol - string - fiat currency ticker
 */
function getFiatToPwrEquivalent(amount, fiatCurrencySymbol) {
    const BASE_API_URL = "https://api.coinmarketcap.com/v1/ticker";
    let API_URL = BASE_API_URL + "/powercoin/?convert=" + fiatCurrencySymbol;

    // TODO: rework this sync request!
    let response = syncRequest("GET", API_URL);
    if (response && response.statusCode === 200) {
        let json = JSON.parse(response.body);
        let pwrPrice = parseFloat(json[0]["price_" + fiatCurrencySymbol.toLowerCase()]);
        return (parseFloat(amount) / pwrPrice).toFixed(8).toString();
    }
    return null
}

/**
 * Validate syntax and check if user's balance is enough to manipulate the
 * requested amount and also stop manipulation if amount is 0.
 * @param amount
 * @param balance
 */
function getValidatedAmount(amount, balance) {
    amount = amount.trim();
    if (config_bot.debug) {
        console.log("getValidatedAmount amount: ", amount);
    }

    // Has currency symbol (pwr/pwrs/ or fiat)
    if (amount.toLowerCase().endsWith("pwr")) {
        if (isNaN(amount.substring(0, amount.length - 3))) {
            return null
        }
        amount = amount.substring(0, amount.length - 3);
    } else if (amount.toLowerCase().endsWith("pwrs")) {
        if (isNaN(amount.substring(0, amount.length - 4))) {
            return null
        }
        amount = amount.substring(0, amount.length - 4);
    } else if (allowedFiatCurrencySymbols.indexOf(amount.toUpperCase().slice(-3)) > -1) {
        if (config_bot.debug) {
            console.log("Amount string is: " + amount + ", amount is: " + amount.substring(0, amount.length - 3) + ", fiat symbol is: " + amount.toLowerCase().slice(-3));
        }

        if (isNaN(amount.substring(0, amount.length - 3))) {
            return null
        }

        amount = getFiatToPwrEquivalent(amount.substring(0, amount.length - 3), amount.toLowerCase().slice(-3));
        if (amount === null) {
            console.log("Can't get exchange rate!");
            return null
        }
    }

    // Is random
    if (amount.toLowerCase() === "random") {
        // random <0.0, 0.1) PWRs
        amount = Math.random() / 10;
        // 8 decimals maximum
        amount = Math.trunc((parseFloat(amount) * 10e7)) / 10e7;
        return amount
    }

    // Is not a number
    if (isNaN(amount)) {
        return null
    }

    // Is a number
    if (amount.match(/^[0-9]+(\.[0-9]+)?$/)) {
        // 8 decimals maximum
        amount = Math.trunc((parseFloat(amount) * 10e7)) / 10e7;

        if ((amount > 0) && (amount <= balance)) {
            return amount;
        }
    }

    // Invalid amount
    if (amount > 50000000) {
        return "Over";
    } else if (amount < 1){
        return "Under";
    }
    return null
}

/**
 * Validate amount if max is lower than maxTipPwrAmount = 50000000
 * * @param amount
 */
function getValidatedMaxAmount(amount) {
    let maxTipPwrAmount = 50000000;
    let minTipPwrAmount = 1;
    if (amount <= maxTipPwrAmount && amount >= minTipPwrAmount) {
        return amount
    } else {
        return null
    }
}

/**
 * @param message
 * @param tipper
 * @param words
 */
function doWithdraw(message, tipper, words) {
    if (message.channel.type !== "dm") {
        return message.reply("Stop spamming and send me this in a DM!").then(message => message.delete(10000));
    }

    //  wrong command syntax
    if (words.length < 4 || !words) {
        return doHelp(message);
    }

    getBalance(tipper, function (err, balance) {
        if (err) {
            return message.reply("error getting balance!");
        }

        let amount = getValidatedAmount(words[2], balance);
        if (amount === null) {
            return message.reply("Seriously? You don't have that many PWRs!");
        } else if (amount === "Over") {
            return message.reply("WOW? Over 50000000! Cut that into pieces, I can't handle that much PWR at once.");
        }

        const destinationAddress = words[3];

       //  only 5 or 6 addresses are supported!
       // if ((destinationAddress.charAt(0) !== '5') || (destinationAddress.charAt(0) !== '6') ) {
       //     return message.reply("this does not appear to be a valid address");
       // }

        power.cmd("sendFrom", tipper.address, destinationAddress, amount, "minconf=10" , "", "",
            function (err, txId) {
                if (err) {
                    message.reply(err.message);
                } else {
                    // update tippers spent amount
                    User.update(
                        {discordID: tipper.discordID},
                        {"$inc": {spent: amount}},
                        function (err, raw) {
                            if (err) {
                                console.error(err);
                            } else {
                                console.log(raw);
                            }
                        }
                    );
                    return message.reply("You cleaned me out of  **" + amount.toString() + " PWR** (- fee) to **" + destinationAddress + "** (" + txLink(txId) + ")!");
                }
            }
        );
    });
}

function retreiveChannelTipObjIdx(set, channel_id) {
    for (let i = 0; i < set.length; i++) {
        if (set[i].channel_id === channel_id) {
            return i
        }
    }
    return null
}

/**
 * @param message
 * @param receiver
 * @param words
 * @param bot
 */
function doOpenTip(message, receiver, words, bot) {
    if (message.channel.type === "dm") {
        return message.reply("Don't talk to me about this here. Go back to the chat room!");
    }

    // wrong command syntax
    if (words.length < 2 || !words) {
        return doHelp(message);
    }

    let idx = retreiveChannelTipObjIdx(tipAllChannels, message.channel.id);
    if (idx === null) {
        return message.reply("Too slow! Nothing left to `open`").then(message => message.delete(10000));
    }
    if (config_bot.debug) {
        console.log("open idx", idx);
    }

    let tipper = tipAllChannels[idx].tipper;
    if (config_bot.debug) {
        console.log("open tipper.discordID", tipper.discordID);
    }

    getBalance(tipper, function (err, balance) {
        if (err) {
            return message.reply("error getting balance!");
        }

        let amount;
        if (tipAllChannels[idx].luck) {
            if (config_bot.debug) {
                console.log("open tipAllChannels[idx].n_used ", tipAllChannels[idx].n_used);
                console.log("open tipAllChannels[idx].luck_tips ", tipAllChannels[idx].luck_tips);
            }
            amount = parseFloat(tipAllChannels[idx].luck_tips[tipAllChannels[idx].n_used]).toFixed(8);
        } else {
            if (config_bot.debug) {
                console.log("open tipAllChannels[idx].amount_total: ", tipAllChannels[idx].amount_total);
                console.log("open tipAllChannels[idx].quotient ", tipAllChannels[idx].quotient);
            }
            amount = parseFloat(tipAllChannels[idx].quotient).toFixed(8);
        }
        if (config_bot.debug) {
            console.log("open amount: ", amount);
            console.log("open balance: ", balance);
        }

        if ((amount <= 0) || (amount > balance)) {
            return message.reply("Um....I don't know how to tip that many PWRs!");
        }

        // prevent user from opening your own tip
        if (tipper.discordID === message.author.id) {
            return message.reply("WOW! Stealing from yourself? You can't `open` your own tip ...").then(message => message.delete(10000));
        }

        getUser(receiver.id, function (err, rec) {
            if (err) {
                return message.reply(err.message);
            }

            if (config_bot.debug) {
                console.log("open receiver.discordID ", receiver.discordID);
            }

            for (let i = 0; i < tipAllChannels[idx].used_user.length; i++) {
                if (tipAllChannels[idx].used_user[i].id === message.author.id) {
                    return message.reply("I don't like cheaters so you can't `open` this for the second time ...").then(message => message.delete(10000));
                }
            }

            sendPwr(tipper, receiver, amount);
            bot.users.get(tipper.discordID).send("<@" + message.author.id + "> received your tip (" + amount.toString() + " PWR)!");
            message.author.send("<@" + tipper.discordID + "> sent you a **" + amount.toString() + " PWR** tip !");

            if (config_bot.debug) {
                console.log("open message.author.id ", message.author.id);
            }

            tipAllChannels[idx].n_used += 1;
            tipAllChannels[idx].used_user.push({
                id: message.author.id,
                amount: amount
            });

            if (config_bot.debug) {
                console.log("tipAllChannels[idx].n", tipAllChannels[idx].n);
                console.log("tipAllChannels[idx].n_used", tipAllChannels[idx].n_used);
            }

            // if empty, then remove from active list of open tips
            if (tipAllChannels[idx].n === tipAllChannels[idx].n_used) {
                tipAllChannels.splice(idx, 1);

                return message.reply("@everyone else is too slow. Package from <@" + tipper.discordID + "> is now empty, thank you!");
            }
        });
    });
}

/**
 * Try to find if channel has been already used, if so, then replace last open tip in that channel.
 * @param set of objects
 * @param obj - we are looking for this in 'set'
 */
function isChannelTipAlreadyExist(tip, message) {
    let now = new Date();
    // in minutes
    let allowedTimeBetweenChannelTips = 5;
    let diffMs;
    let diffMins;
    let type = tip.luck ? "LUCK" : "EACH";

    for (let i = 0; i < tipAllChannels.length; i++) {
        if (tipAllChannels[i].channel_id === tip.channel_id) {
            // milliseconds between now
            diffMs = (now - tipAllChannels[i].creation_date);
            // minutes
            diffMins = Math.round(((diffMs % 86400000) % 3600000) / 60000);

            if (config_bot.debug) {
                console.log("isChannelTipAlreadyExist diffMs: ", diffMs);
                console.log("isChannelTipAlreadyExist diffMins: ", diffMins);
            }

            if (diffMins > allowedTimeBetweenChannelTips) {
                // tip already exist, but it expire -> replace it
                tipAllChannels[i] = tip;
                message.reply("A new PWR `" + type + "` package has been created (" + tip.amount_total.toString() + " PWR)! Claim it with command `!tip open`");
                return 0
            } else {
                // tip already exist and is still valid
                message.reply("Wait your turn, there is a previous tip is in progress!\n**" + tipAllChannels[i].n_used + "/" + tipAllChannels[i].n + " opened**\n**" + (5 - diffMins) + " minutes left**" );
                return 1
            }
        }
    }
    // tip doesnt exist in this channel -> create new
    tipAllChannels.push(tip);
    message.reply("A new PWR `" + type + "` package has been created (" + tip.amount_total.toString() + " PWR)! Claim it with command `!tip open`");
    return 2
}

/**
 * Shuffle array.
 * @param array
 */
function shuffle(array) {
    let counter = array.length;

    // While there are elements in the array
    while (counter > 0) {
        // Pick a random index
        let index = Math.floor(Math.random() * counter);

        // Decrease counter by 1
        counter--;

        // And swap the last element with it
        let temp = array[counter];
        array[counter] = array[index];
        array[index] = temp;
    }

    return array;
}

/**
 * @param message
 * @param tipper
 * @param words
 */
function createTipLuck(message, tipper, words) {
    if (message.channel.type === "dm") {
        return message.reply("Go back to the chat room to do this!");
    }

    // wrong command syntax
    if (words.length < 4 || !words) {
        return doHelp(message);
    }

    getBalance(tipper, function (err, balance) {
        if (err) {
            return message.reply("I have no idea why, but I can't seem to get your balance");
        }

        let amountToValidate = getValidatedAmount(words[2], balance);
        amountToValidate = getValidatedMaxAmount(amountToValidate);
        if (amountToValidate === null) {
            return message.reply("I think you forgot to tip some PWRs!");
        } else if (amountToValidate === "Over") {
            return message.reply("Um....you are WAY to high!");
        } else if (amountToValidate === "Under") {
            return message.reply("Wow! You are one cheap person!");
        }

        let amount = parseFloat(amountToValidate).toFixed(8);
        let n = parseFloat(words[3]).toFixed(8);
        if (isNaN(n) || n <= 0) {
            return message.reply("I don't know how to tip that many people!");
        } else if (amount < 1) {
            return message.reply("Seriously?");
        } else if (n > 100) {
            return message.reply("100 people is the maximum per packet!");
        }
        let quotient = (amount / n).toFixed(8);

        if (config_bot.debug) {
            console.log("createTipLuck amount", amount);
            console.log("createTipLuck n", n);
            console.log("createTipLuck quotient", quotient);
        }

        let luckTips = new Array(parseInt(n));
        if (n > 1) {
            for (let i = 0; i < (luckTips.length - 1); i++) {
                luckTips[i] = (Math.random() * parseFloat(quotient)).toFixed(8);
            }

            let sum = luckTips.reduce(function (total, num) {
                return parseFloat(total) + parseFloat(num)
            });
            if (config_bot.debug) {
                console.log("createTipLuck sum", sum);
            }

            luckTips[luckTips.length - 1] = (parseFloat(amount) - parseFloat(sum)).toFixed(8);
            if (config_bot.debug) {
                console.log("createTipLuck luckTips", luckTips);
            }

            // shuffle random tips (somewhere is BONUS) :-)
            luckTips = shuffle(luckTips);
            if (config_bot.debug) {
                console.log("createTipLuck luckTips (shuffled) ", luckTips);
            }
        } else {
            luckTips[0] = parseFloat(amount).toFixed(8);
        }

        let tipOneChannel = {
            channel_id: message.channel.id,
            tipper: tipper,
            luck: true,
            amount_total: amount,
            quotient: quotient,
            n: parseInt(n),
            n_used: 0,
            luck_tips: luckTips,
            used_user: [],
            creation_date: new Date()
        };

        isChannelTipAlreadyExist(tipOneChannel, message);
    });
}

/**
 * @param message
 * @param tipper
 * @param words
 */
function createTipEach(message, tipper, words) {
    if (message.channel.type === "dm") {
        return message.reply("you can't send me this command in direct message!");
    }

    // wrong command syntax
    if (words.length < 4 || !words) {
        return doHelp(message);
    }

    getBalance(tipper, function (err, balance) {
        if (err) {
            return message.reply("Error getting balance");
        }

        let amountToValidate = getValidatedAmount(words[2], balance);
        amountToValidate = getValidatedMaxAmount(amountToValidate);
        if (amountToValidate === null) {
            return message.reply("I think you forgot something.");
        } else if (amountToValidate === "Over") {
            return message.reply("Um....you are WAY to high!");
        } else if (amountToValidate === "Under") {
            return message.reply("Wow! You are one cheap person!");
        }

        let amount = parseFloat(amountToValidate).toFixed(8);
        if (config_bot.debug) {
            console.log("createTipEach amount", amount);
        }

        let n = parseFloat(words[3]).toFixed(8);
        if (isNaN(n) || n <= 0) {
            return message.reply("I dont know how to tip that many people!");
        } else if (amount < 1) {
            return message.reply("Seriously?");
        } else if (n > 100) {
            return message.reply("100 people is the maximum per packet!");
        }

        let quotient = (amount / n).toFixed(8);
        if (config_bot.debug) {
            console.log("createTipEach n", n);
            console.log("createTipEach quotient", quotient);
            console.log("createTipEach amount", amount);
        }

        let tipOneChannel = {
            channel_id: message.channel.id,
            tipper: tipper,
            luck: false,
            amount_total: amount,
            quotient: quotient,
            n: parseInt(n),
            n_used: 0,
            used_user: [],
            creation_date: new Date()
        };

        isChannelTipAlreadyExist(tipOneChannel, message);
    });
}

/**
 * @param usertxt
 */
function resolveMention(usertxt) {
    let userid = usertxt;
    if (usertxt.startsWith("<@!")) {
        userid = usertxt.substr(3, usertxt.length - 4);
    } else {
        if (usertxt.startsWith("<@")) {
            userid = usertxt.substr(2, usertxt.length - 3);
        }
    }
    return userid;
}

/**
 * @param message
 * @param tipper
 * @param words
 * @param bot
 */
function doTip(message, tipper, words, bot) {
    if (message.channel.type === "dm") {
        return message.reply("you can't send me this command in direct message!");
    }

    // wrong command syntax
    if (words.length < 3 || !words) {
        return doHelp(message);
    }

    getBalance(tipper, function (err, balance) {
        if (err) {
            return message.reply("error getting balance");
        }

        let amountToValidate = getValidatedAmount(words[2], balance);
        amountToValidate = getValidatedMaxAmount(amountToValidate);
        if (amountToValidate === null) {
            return message.reply("I think you forgot something.");
        } else if (amountToValidate === "Over") {
            return message.reply("WHALE!!! Try a lower amount you showoff!");
        }

        let amount = parseFloat(amountToValidate.toFixed(8));
        let targetId = resolveMention(words[1]);
        if (config_bot.debug) {
            console.log("doTip targetId", targetId);
        }

        bot.fetchUser(targetId, true).then(target => {
            if (config_bot.debug) {
                console.log("doTip target.id", target.id);
            }

            if (!target) {
                return message.reply("I cant't find a user in your tip ...");
            } else {
                if (tipper.discordID === target.id) {
                    return message.reply("Really!!?? I mean....seriously...");
                }

                getUser(target.id, function (err, receiver) {
                    if (err) {
                        return message.reply(err.message);
                    }

                    sendPwr(tipper, receiver, amount);
                    message.author.send("<@" + receiver.discordID + "> received your tip (" + amount + " PWR)!");
                    target.send("<@" + tipper.discordID + "> sent you a **" + amount + " PWR** tip !");
                });
            }
        }).catch(err => {
            console.log("Failed fetch user: ", err);
        });
    });
}

/**
 * @param tipper
 * @param receiver
 * @param amount
 */
function sendPwr(tipper, receiver, amount) {
    // update tipper's spent amount
    User.update(
        {discordID: tipper.discordID},
        {"$inc": {spent: amount}},
        function (err, raw) {
            if (err) {
                console.error(err);
            } else {
                console.log(raw);
            }
        }
    );

    // and receiver's received amount
    User.update(
        {discordID: receiver.discordID},
        {"$inc": {received: amount}},
        function (err, raw) {
            if (err) {
                console.error(err);
            } else {
                console.log(raw);
            }
        }
    );
}

/**
 * @param txId is transaction id
 */
function txLink(txId) {
    return "<https://blockexplorer.pwr-coin.com/tx/" + txId + ">";
}
