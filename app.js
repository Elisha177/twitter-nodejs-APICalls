const express = require("express");
const app = express();
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
app.use(express.json());
const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// Initialize DB and Server
const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`Error at ${e.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

// Helper Function to Get Following People IDs
const getFollowingPeopleIdsOfUser = async (username) => {
  const getTheFollowingPeopleQuery = `
    SELECT following_user_id 
    FROM follower 
    INNER JOIN user ON user.user_id = follower.follower_user_id
    WHERE user.username = ?;`;

  const followingPeople = await db.all(getTheFollowingPeopleQuery, [username]);
  return followingPeople.map((eachUser) => eachUser.following_user_id);
};

// Authentication Middleware
const authentication = (req, res, next) => {
  let jwtToken;
  const authHeader = req.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }

  if (jwtToken === undefined) {
    res.status(401).send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "SECRET_KEY", (error, payload) => {
      if (error) {
        res.status(401).send("Invalid JWT Token");
      } else {
        req.username = payload.username;
        req.userId = payload.userId;
        next();
      }
    });
  }
};

// Register API
app.post("/register/", async (req, res) => {
  const { username, password, name, gender } = req.body;
  const getUserQuery = `SELECT * FROM user WHERE username = ?;`;
  const getDBDetails = await db.get(getUserQuery, [username]);

  if (getDBDetails !== undefined) {
    res.status(400).send("User already exists");
  } else if (password.length < 6) {
    res.status(400).send("Password is too short");
  } else {
    const hashedPassword = await bcrypt.hash(password, 10);
    const createUserQuery = `INSERT INTO user(username, password, name, gender)
                             VALUES(?, ?, ?, ?)`;
    await db.run(createUserQuery, [username, hashedPassword, name, gender]);
    res.send("User created successfully");
  }
});

// Login API
app.post("/login/", async (req, res) => {
  const { username, password } = req.body;
  const getUserQuery = `SELECT * FROM user WHERE username = ?;`;
  const userDbDetails = await db.get(getUserQuery, [username]);

  if (userDbDetails !== undefined) {
    const isPasswordCorrect = await bcrypt.compare(
      password,
      userDbDetails.password
    );

    if (isPasswordCorrect) {
      const payload = { username, userId: userDbDetails.user_id };
      const jwtToken = jwt.sign(payload, "SECRET_KEY");
      res.send({ jwtToken });
    } else {
      res.status(400).send("Invalid password");
    }
  } else {
    res.status(400).send("Invalid user");
  }
});

// Middleware for Tweet Access Verification
const tweetAccessVerification = async (req, res, next) => {
  const { tweetId } = req.params;
  const { userId } = req;

  // Check if the tweet belongs to the user or the user follows the tweet's author
  const checkTweetAccessQuery = `
    SELECT *
    FROM tweet
    INNER JOIN follower ON tweet.user_id = follower.following_user_id
    WHERE tweet.tweet_id = ?
    AND (tweet.user_id = ? OR follower.follower_user_id = ?);`;

  const tweetAccess = await db.get(checkTweetAccessQuery, [
    tweetId,
    userId,
    userId,
  ]);

  if (tweetAccess) {
    next();
  } else {
    res.status(401);
    res.send("Invalid Request");
  }
};
// Get Tweets Feed API
app.get("/user/tweets/feed/", authentication, async (req, res) => {
  const { username } = req;
  const followingPeopleIds = await getFollowingPeopleIdsOfUser(username);

  const getTweetsQuery = `
    SELECT username, tweet, date_time AS dateTime
    FROM user 
    INNER JOIN tweet ON user.user_id = tweet.user_id
    WHERE user.user_id IN (${followingPeopleIds.join(",")})
    ORDER BY date_time DESC
    LIMIT 4;`;

  const tweets = await db.all(getTweetsQuery);
  res.send(tweets);
});

// Get Following API
app.get("/user/following/", authentication, async (req, res) => {
  const { userId } = req;
  const getFollowingUsersQuery = `SELECT name FROM follower
    INNER JOIN user ON user.user_id = follower.following_user_id
    WHERE follower_user_id = ?;`;

  const followingPeople = await db.all(getFollowingUsersQuery, [userId]);
  res.send(followingPeople);
});

// Get Followers API
app.get("/user/followers/", authentication, async (req, res) => {
  const { userId } = req;
  const getFollowersQuery = `SELECT DISTINCT name FROM follower
    INNER JOIN user ON user.user_id = follower.follower_user_id
    WHERE following_user_id = ?;`;

  const followers = await db.all(getFollowersQuery, [userId]);
  res.send(followers);
});

// Get Tweet API
app.get(
  "/tweets/:tweetId/",
  authentication,
  tweetAccessVerification,
  async (req, res) => {
    const { tweetId } = req.params;
    const getTweetQuery = `
    SELECT tweet,
           (SELECT COUNT(*) FROM like WHERE tweet_id = ?) AS likes,
           (SELECT COUNT(*) FROM reply WHERE tweet_id = ?) AS replies,
           date_time AS dateTime
    FROM tweet
    WHERE tweet.tweet_id = ?;`;

    const tweet = await db.get(getTweetQuery, [tweetId, tweetId, tweetId]);
    res.send(tweet);
  }
);

// Get Likes API
app.get(
  "/tweets/:tweetId/likes/",
  authentication,
  tweetAccessVerification,
  async (req, res) => {
    const { tweetId } = req.params;
    const getLikesQuery = `
    SELECT username
    FROM user
    INNER JOIN like ON user.user_id = like.user_id
    WHERE like.tweet_id = ?;`;

    const likedUsers = await db.all(getLikesQuery, [tweetId]);
    const usersArray = likedUsers.map((eachUser) => eachUser.username);
    res.send({ likes: usersArray });
  }
);

// Get Replies API
app.get(
  "/tweets/:tweetId/replies/",
  authentication,
  tweetAccessVerification,
  async (req, res) => {
    const { tweetId } = req.params;
    const getRepliedQuery = `
    SELECT name, reply
    FROM user
    INNER JOIN reply ON user.user_id = reply.user_id
    WHERE reply.tweet_id = ?;`;

    const repliedUsers = await db.all(getRepliedQuery, [tweetId]);
    res.send({ replies: repliedUsers });
  }
);

// Get User Tweets API
app.get("/user/tweets/", authentication, async (req, res) => {
  const { userId } = req;

  const getTweetsQuery = `
    SELECT tweet,
    COUNT(DISTINCT like_id) AS likes,
    COUNT(DISTINCT reply_id) AS replies,
    date_time AS dateTime
    FROM tweet 
    LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
    LEFT JOIN like ON tweet.tweet_id = like.tweet_id
    WHERE tweet.user_id = ?
    GROUP BY tweet.tweet_id;`;

  const tweets = await db.all(getTweetsQuery, [userId]);
  res.send(tweets);
});

// Create Tweet API
app.post("/user/tweets/", authentication, async (req, res) => {
  const { tweet } = req.body;
  const { userId } = req;
  const dateTime = new Date().toISOString().replace("T", " ").slice(0, 19);

  const createTweetQuery = `INSERT INTO tweet(tweet, user_id, date_time)
    VALUES(?, ?, ?);`;

  await db.run(createTweetQuery, [tweet, userId, dateTime]);
  res.send("Created a Tweet");
});

// Delete Tweet API
app.delete("/tweets/:tweetId/", authentication, async (req, res) => {
  const { tweetId } = req.params;
  const { userId } = req;

  const getTweetQuery = `SELECT * FROM tweet WHERE user_id = ? AND tweet_id = ?;`;
  const tweet = await db.get(getTweetQuery, [userId, tweetId]);

  if (tweet === undefined) {
    res.status(401).send("Invalid Request");
  } else {
    const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id = ?;`;
    await db.run(deleteTweetQuery, [tweetId]);
    res.send("Tweet Removed");
  }
});

module.exports = app;
