var Twit = require("twit"),
  T = new Twit(require("./config.js"));

var wptKey = require("./wpt.config.js").k;

var WebPageTest = require("webpagetest"),
  wpt = new WebPageTest("www.webpagetest.org", wptKey);

var uu = require("url-unshort")({
  nesting: 4
});

var scoreToLetter = function(score) {
  if (score >= 90) return "A";
  else if (score >= 80) return "B";
  else if (score >= 70) return "C";
  else if (score >= 60) return "D";
  else return "F";
};

T.get("account/verify_credentials", { skip_status: true })
  .catch(function(err) {
    console.log("caught error", err.stack);
  })
  .then(function(result) {
    // `result` is an Object with keys "data" and "resp".
    // `data` and `resp` are the same objects as the ones passed
    // to the callback.
    // See https://github.com/ttezel/twit#tgetpath-params-callback
    // for details.

    //console.log('data', result.data);
    return result.data.screen_name;
  })
  .then(function(botName) {
    var stream = T.stream("statuses/filter", {
      track: "@" + botName
    });

    console.log("@" + botName + " is now listening...\n");

    stream.on("tweet", function(message) {
      var screenName = message.user.screen_name;

      /*
        This is the return case, in which we want to prevent this from going to WPT.
        1. When the tweeter is the bot itself, we need to prevent ifinite loops
        2. When the tweet is a retweet
        3. When the tweet is a quote
      */
      if (
        screenName === botName ||
        message.retweeted_status ||
        message.quoted_status
      ) {
        return;
      }

      // This is the regex for detecting URL strings in the incoming tweet.  Probably imperfect and could be better, but works for now.
      var reURL = /(http:\/\/www\.|https:\/\/www\.|http:\/\/|https:\/\/)?[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,5}(:[0-9]{1,5})?(\/.*)?/gm;

      // Attempt to find the url in the tweet text
      var urlSearch = message.text.match(reURL);

      if (urlSearch) {
        // This will set the detected URL
        var urlToTest = urlSearch[0].split(" ")[0];

        // This will print the detected URL to the console
        console.log(
          "URL was recognized in a tweet by @" +
            screenName +
            ": " +
            urlToTest +
            "\n"
        );

        uu.expand(urlToTest)
          .then(function(url) {
            if (url) {
              console.log("Expanded url is: " + url + "\n");
              /*
            This is the actual sending of the detected URL to WebPageTest for performance testing.  Right now with simple default settings.
            It also tweets the result URL back to the original tweeter
          */
              wpt.runTest(url, { pollResults: 30, timeout: 600 }, function(
                err,
                data
              ) {
                !err ? (data = data.data) : (data = data);
                console.log("Data: ", data);
                console.log("\n\n");
                var thisStatus;
                if (err) {
                  console.log(err);
                  thisStatus =
                    "Hey @" +
                    screenName +
                    ", it looks like something went wrong with testing this URL.  WebPageTest threw me an error, sorry about that.";
                } else {
                  thisStatus =
                    "Hey @" +
                    screenName +
                    ",\n\nLink to Result: " +
                    data.summary +
                    "\n\n" +
                    "Time to First Byte: " +
                    data.average.firstView.TTFB +
                    "ms\n\n" +
                    "Keep Alive Score: " +
                    scoreToLetter(data.average.firstView["score_keep-alive"]) +
                    "\n\n" +
                    "Compress Transfer Score: " +
                    scoreToLetter(data.average.firstView.score_gzip) +
                    "\n\n" +
                    "Compress Images Score: " +
                    scoreToLetter(data.average.firstView.score_compress) +
                    "\n\n" +
                    "Cache Static Content Score: " +
                    scoreToLetter(data.average.firstView.score_cache) +
                    "\n\n" +
                    "Effective CDN Score: " +
                    scoreToLetter(data.average.firstView.score_cdn) +
                    "\n\n";
                }
                T.post(
                  "statuses/update",
                  {
                    status: thisStatus,
                    in_reply_to_status_id: message.id_str
                  },
                  function(err, data, response) {
                    // console.log(data)
                  }
                );
              });
            } else {
              console.log("This url can't be expanded");
              T.post(
                "statuses/update",
                {
                  status:
                    "Hey @" +
                    screenName +
                    ", it looks like that url cannot be expanded from the shortened version.  Sorry about that.",
                  in_reply_to_status_id: message.id_str
                },
                function(err, data, response) {
                  // console.log(data)
                }
              );
            }
          })
          .catch(function(err) {
            console.log(err);
            T.post(
              "statuses/update",
              {
                status:
                  "Hey @" +
                  screenName +
                  ", I had some trouble with that url.  Most likely too many redirects or shorteners.  Sorry about that.",
                in_reply_to_status_id: message.id_str
              },
              function(err, data, response) {
                // console.log(data)
              }
            );
          });
      } else {
        // @Todo --> handle the case (and probably have fun with) where no URL is in the tweet
        console.log(
          "Saw a tweet by @" + screenName + " but did not find a URL in it\n"
        );
        return;
      }
    });
  });
