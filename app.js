// This loads the environment variables from the .env file
require('dotenv-extended').load();

var builder = require('botbuilder');
var restify = require('restify');
var Store = require('./store');
var spellService = require('./spell-service');
var ssml = require('./ssml');
var Curl = require( 'node-libcurl' ).Curl;
const googleTrends = require('google-trends-api');

// Setup Restify Server
var server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
    console.log('%s listening to %s', server.name, server.url);
});
// Create connector and listen for messages
var connector = new builder.ChatConnector({
    appId: process.env.MICROSOFT_APP_ID,
    appPassword: process.env.MICROSOFT_APP_PASSWORD
});
server.post('/api/messages', connector.listen());

var bot = new builder.UniversalBot(connector, function (session) {
    session.send('Sorry, I did not understand \'%s\'. Type \'help\' if you need assistance.', session.message.text);
});

// You can provide your own model by specifing the 'LUIS_MODEL_URL' environment variable
// This Url can be obtained by uploading or creating your model from the LUIS portal: https://www.luis.ai/
var recognizer = new builder.LuisRecognizer(process.env.LUIS_MODEL_URL);
bot.recognizer(recognizer);

bot.dialog('CreateGameDialog', [
    function (session, args, next) {
        // Initialize game structure.
        // - dialogData gives us temporary storage of this data in between
        //   turns with the user.
        var game = session.dialogData.game = { 
            type: 'custom', 
            sides: null, 
            count: null,
            turns: 0,
            debug: null
        };

        /**
         * Ask for the number of sides.
         * 
         * You can pass an array of choices to be matched. These will be shown as a
         * numbered list by default.  This list will be shown as a numbered list which
         * is what we want since we have so many options.
         * 
         * - value is what you want returned via 'results.response.entity' when selected.
         * - action lets you customize the displayed label and for buttons what get sent when clicked.
         * - synonyms let you specify alternate things to recognize for a choice.
         */
        var choices = [
            { value: '4', action: { title: '4 Sides' }, synonyms: 'four|for|4 sided|4 sides' },
            { value: '6', action: { title: '6 Sides' }, synonyms: 'six|sex|6 sided|6 sides' },
            { value: '8', action: { title: '8 Sides' }, synonyms: 'eight|8 sided|8 sides' },
            { value: '10', action: { title: '10 Sides' }, synonyms: 'ten|10 sided|10 sides' },
            { value: '12', action: { title: '12 Sides' }, synonyms: 'twelve|12 sided|12 sides' },
            { value: '20', action: { title: '20 Sides' }, synonyms: 'twenty|20 sided|20 sides' }
        ];
        // builder.Prompts.choice(session, 'choose_sides', choices, { 
        //     speak: speak(session, 'choose_sides_ssml') 
        // });
        var sidesEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'Sides');
        if (sidesEntity){
            game.sides = sidesEntity.entity;
        }
        var countEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'Count');
        if (countEntity){
            game.count = countEntity.entity;
        }

        if (sidesEntity) {
            // city entity detected, continue to next step
            next({ response: sidesEntity.entity });
        } else {
            // no entities detected, ask user for a destination
            builder.Prompts.text(session, 'Please enter the number of sides of the dice to be rolled.', { 
                speak: speak(session, 'choose_number_of_sides') 
            });
        }
    },
    function (session, results, next) {
        // Store users input
        // - The response comes back as a find result with index & entity value matched.
        var game = session.dialogData.game;
        game.sides = Number(results.response);

        /**
         * Ask for number of dice.
         * 
         * - We can use gettext() to format a string using a template stored in our
         *   localized prompts file.
         * - The number prompt lets us pass additional options to say we only want
         *   integers back and what's the min & max value that's allowed.
         */

        if (game.count !== null) {
            // city entity detected, continue to next step
            next({ response: game.count });
        } else {
            // no entities detected, ask user for a destination
            var prompt = session.gettext('choose_count', game.sides);
            builder.Prompts.number(session, prompt, {
                speak: speak(session, 'choose_count_ssml'),
                minValue: 1,
                maxValue: 100,
                integerOnly: true
            });
        }

    },
    function (session, results) {
        // Store users input
        // - The response is already a number.
        var game = session.dialogData.game;
        if (results.response === 'once'){
            game.count = 1;
        }
        else if (results.response === 'twice'){
            game.count = 2;
        }
        else if ( ! isNaN(Number(results.response))){
            game.count = Number(results.response);
        }
        else{
            game.count = 1;
        }
        


        /**
         * Play the game we just created.
         * 
         * We can use replaceDialog() to end the current dialog and start a new
         * one in its place. We can pass arguments to dialogs so we'll pass the
         * 'PlayGameDialog' the game we created.
         */
        session.replaceDialog('PlayGameDialog', { game: game });
    }
]).triggerAction({ matches: 'CreateGameDialog'});


bot.dialog('PlayGameDialog', function (session, args) {
    // Get current or new game structure.
    var game = args.game || session.conversationData.game;
    if (game) {
        // Generate rolls
        var total = 0;
        var rolls = [];
        for (var i = 0; i < game.count; i++) {
            var roll = Math.floor(Math.random() * game.sides) + 1;
            if (roll > game.sides) {
                // Accounts for 1 in a million chance random() generated a 1.0
                roll = game.sides;
            }
            total += roll;
            rolls.push(roll);
        }

        // Format roll results
        var results = '';
        var multiLine = rolls.length > 5;
        for (var i = 0; i < rolls.length; i++) {
            if (i > 0) {
                results += ' . ';
            }
            results += rolls[i];
        }

        // Render results using a card
        var card = new builder.HeroCard(session)
            .subtitle(game.count > 1 ? 'card_subtitle_plural' : 'card_subtitle_singular', game)
            .buttons([
                builder.CardAction.imBack(session, 'roll again', 'Roll Again'),
                builder.CardAction.imBack(session, 'new game', 'New Game')
            ]);
        if (multiLine) {
            //card.title('card_title').text('\n\n' + results + '\n\n');
            card.text(results);
        } else {
            card.title(results);
        }
        var msg = new builder.Message(session).addAttachment(card);

        // Determine bots reaction for speech purposes
        var reaction = 'normal';
        var min = game.count;
        var max = game.count * game.sides;
        var score = total/max;
        if (score === 1.0) {
            reaction = 'best';
        } else if (score === 0) {
            reaction = 'worst';
        } else if (score <= 0.3) {
            reaction = 'bad';
        } else if (score >= 0.8) {
            reaction = 'good';
        }
        
        // Check for special craps rolls
        if (game.type === 'craps') {
            switch (total) {
                case 2:
                case 3:
                case 12:
                    reaction = 'craps_lose';
                    break;
                case 7:
                    reaction = 'craps_seven';
                    break;
                case 11:
                    reaction = 'craps_eleven';
                    break;
                default:
                    reaction = 'craps_retry';
                    break;
            }
        }

        // Build up spoken response
        var spoken = '';
        if (game.turn === 0) {
            spoken += session.gettext('start_' + game.type + '_game_ssml') + ' ';
        } 
        spoken += session.gettext(reaction + '_roll_reaction_ssml');
        msg.speak(ssml.speak(spoken));

        // Incrment number of turns and store game to roll again
        game.turn++;
        session.conversationData.game = game;

        /**
         * Send card and bots reaction to user. 
         */
        msg.inputHint(builder.InputHint.acceptingInput);
        session.send(msg).endDialog();
    } else {
        // User started session with "roll again" so let's just send them to
        // the 'CreateGameDialog'
        session.replaceDialog('CreateGameDialog');
    }
}).triggerAction({ matches: 'PlayGameDialog' });


bot.dialog('SearchHotels', [
    function (session, args, next) {
        session.send('Welcome to the Hotels finder! We are analyzing your message: \'%s\'', session.message.text);

        // try extracting entities
        var cityEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'builtin.geography.city');
        var airportEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'AirportCode');
        if (cityEntity) {
            // city entity detected, continue to next step
            session.dialogData.searchType = 'city';
            next({ response: cityEntity.entity });
        } else if (airportEntity) {
            // airport entity detected, continue to next step
            session.dialogData.searchType = 'airport';
            next({ response: airportEntity.entity });
        } else {
            // no entities detected, ask user for a destination
            builder.Prompts.text(session, 'Please enter your destination');
        }
    },
    function (session, results) {
        var destination = results.response;

        var message = 'Looking for hotels';
        if (session.dialogData.searchType === 'airport') {
            message += ' near %s airport...';
        } else {
            message += ' in %s...';
        }

        session.send(message, destination);

        // Async search
        Store
            .searchHotels(destination)
            .then(function (hotels) {
                // args
                session.send('I found %d hotels:', hotels.length);

                var message = new builder.Message()
                    .attachmentLayout(builder.AttachmentLayout.carousel)
                    .attachments(hotels.map(hotelAsAttachment));

                session.send(message);

                // End
                session.endDialog();
            });
    }
]).triggerAction({
    matches: 'SearchHotels',
    onInterrupted: function (session) {
        session.send('Please provide a destination');
    }
});

bot.dialog('ShowHotelsReviews', function (session, args) {
    // retrieve hotel name from matched entities
    var hotelEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'Hotel');
    if (hotelEntity) {
        session.send('Looking for reviews of \'%s\'...', hotelEntity.entity);
        Store.searchHotelReviews(hotelEntity.entity)
            .then(function (reviews) {
                var message = new builder.Message()
                    .attachmentLayout(builder.AttachmentLayout.carousel)
                    .attachments(reviews.map(reviewAsAttachment));
                session.endDialog(message);
            });
    }
}).triggerAction({
    matches: 'ShowHotelsReviews'
});

bot.dialog('HelpDialog', function (session) {
    session.endDialog('Hi! Try asking me things like \'search hotels in Seattle\', \'search hotels near LAX airport\' or \'show me the reviews of The Bot Resort\'');
}).triggerAction({
    matches: 'HelpDialog'
});

bot.dialog('Search', function (session,args) {
    var entities = [];
    args.intent.entities.forEach(function(element){
        entities.push(element.type);
    });

    var maleEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'male');
    var femaleEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'female');
    var specifyGender = maleEntity || femaleEntity;

    var targetURL = null;

    var weRetailCategories_deleteThis = {
        eq:[
            'biking','hiking','running','surfing','water-sports','winter-sports'
        ]
        ,me:[
            'coats','footwear','gloves','pants','scarfs','shirts','shorts'
        ]
        ,wo:[
            'coats','gloves','pants','shirts','shorts'
        ]
    };

    var weRetailCategories = {
        surfing:{
            category : 'equipment',
            isGenderSpecific : false,
        },
        'water-sports':{
            category : 'equipment',
            isGenderSpecific : false,
        },
        coats:{
            category : null,
            isGenderSpecific : true,
            male:true,
            female:true,
        },
        footwear:{
            category : null,
            isGenderSpecific : true,
            male:true,
            female:false,
        },
        gloves:{
            category : null,
            isGenderSpecific : true,
            male:true,
            female:true,
        },
        pants:{
            category : null,
            isGenderSpecific : true,
            male:true,
            female:true,
        },
        scarfs:{
            category : null,
            isGenderSpecific : true,
            male:true,
            female:false,
        },
        shirts:{
            category : null,
            isGenderSpecific : true,
            male:true,
            female:true,
        },
        shorts:{
            category : null,
            isGenderSpecific : true,
            male:true,
            female:true,
        },
    };

    for (i=0;i<entities.length && !targetURL;i++){
        if( weRetailCategories[entities[i]] ){
            if (weRetailCategories[entities[i]].category){
                targetURL = weRetailCategories[entities[i]].category+'/'+entities[i];
            }
            else{
                if (femaleEntity && weRetailCategories[entities[i]].female){
                    targetURL = 'women/'+entities[i];
                }
                else{
                    targetURL = 'men/'+entities[i];
                }
            }
        }
    }
    if (!targetURL){
        targetURL = 'products';
    }

    // if belong to equipment, go to the target directly
    // for (i=0;i<entities.length && !targetURL;i++){
    //     if (weRetailCategories.eq.includes(entities[i])){
    //         targetURL = 'equipment/'+entities[i];
    //     }
    // }

    // if not belonging to the equipment
        
    var resultObj = {
        interest : entities,
        targetURL: targetURL,
        entities : entities,
        maleEntity : maleEntity,
        femaleEntity : femaleEntity,
        products :[
            {
                "name": "SSGN8"
            },
            {
                "name": "iPhone X"
            }
        ]
    };
    session.endDialog(JSON.stringify(resultObj));

    // ============== test node-libcurl =================================================
    // var curl = new Curl();
    // curl.setOpt( 'URL', 
    //     'https://trends.google.com/trends/api/widgetdata/relatedsearches?hl=en-US&tz=-420&req=%7B%22restriction%22:%7B%22geo%22:%7B%22country%22:%22TH%22%7D,%22time%22:%222017-10-07+2017-11-07%22%7D,%22keywordType%22:%22ENTITY%22,%22metric%22:%5B%22TOP%22,%22RISING%22%5D,%22trendinessSettings%22:%7B%22compareTime%22:%222017-09-05+2017-10-06%22%7D,%22requestOptions%22:%7B%22property%22:%22%22,%22backend%22:%22IZG%22,%22category%22:18%7D,%22language%22:%22en%22%7D&token=APP6_UEAAAAAWgLTub2MMho5DhfuQXUolcJiv9Egg6J2' 
    // );
    // curl.setOpt( 'FOLLOWLOCATION', true );
    // curl.setOpt( 'SSL_VERIFYPEER', false );
    
    // curl.on( 'end', function( statusCode, body, headers ) {
    //     resultObj.testCurl = statusCode + '---' + body.length + '---' + this.getInfo( 'TOTAL_TIME' );     
    //     trendData = JSON.parse(body.substr(6));

    //     resultObj.trendData = trendData;
    //     session.endDialog(JSON.stringify(resultObj));
    //     this.close();
    // });
     
    // curl.on( 'error', function(err, curlErrCode){
    //     console.error( 'Err: ', err );
    //     console.error( 'Code: ', curlErrCode );
    //     resultObj.testCurl = err + '---' + curlErrCode;     
    //     session.endDialog(JSON.stringify(resultObj));
    //     this.close();
    // } );
    // curl.perform();
    
    // ============== end test node-libcurl =================================================


    // ============== test google-trends-api =================================================
    // googleTrends.interestOverTime({keyword: 'Women\'s march'})
    // .then(function(results){
    //   resultObj.googleTrends = results;
    //   session.endDialog(JSON.stringify(resultObj));
    // })
    // .catch(function(err){
    //   session.endDialog(JSON.stringify(resultObj));
    // });
    // ============== end test google-trends-api =================================================


    // var sidesEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'Sides');
    // if (sidesEntity){
    //     game.sides = sidesEntity.entity;
    // }
    // var countEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'Count');
    // if (countEntity){
    //     game.count = countEntity.entity;
    // }

    // if (sidesEntity) {
    //     // city entity detected, continue to next step
    //     next({ response: sidesEntity.entity });
    // } else {
    //     // no entities detected, ask user for a destination
    //     builder.Prompts.text(session, 'Please enter the number of sides of the dice to be rolled.', { 
    //         speak: speak(session, 'choose_number_of_sides') 
    //     });
    // }

    // session.endDialog(JSON.stringify(resultObj));
}).triggerAction({
    matches: 'Search'
});
    

// Spell Check
if (process.env.IS_SPELL_CORRECTION_ENABLED === 'true') {
    bot.use({
        botbuilder: function (session, next) {
            spellService
                .getCorrectedText(session.message.text)
                .then(function (text) {
                    session.message.text = text;
                    next();
                })
                .catch(function (error) {
                    console.error(error);
                    next();
                });
        }
    });
}

// Helpers
function hotelAsAttachment(hotel) {
    return new builder.HeroCard()
        .title(hotel.name)
        .subtitle('%d stars. %d reviews. From $%d per night.', hotel.rating, hotel.numberOfReviews, hotel.priceStarting)
        .images([new builder.CardImage().url(hotel.image)])
        .buttons([
            new builder.CardAction()
                .title('More details')
                .type('openUrl')
                .value('https://www.bing.com/search?q=hotels+in+' + encodeURIComponent(hotel.location))
        ]);
}

function reviewAsAttachment(review) {
    return new builder.ThumbnailCard()
        .title(review.title)
        .text(review.text)
        .images([new builder.CardImage().url(review.image)]);
}
function speak(session, prompt) {
    var localized = session.gettext(prompt);
    return ssml.speak(localized);
}