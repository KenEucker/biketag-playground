import dotenv from "dotenv";
import { BikeTagClient } from "biketag";
import FormData from 'form-data';

dotenv.config();

const opts: any = {
  game: process.env.BIKETAG_GAME ?? "test",
  imgur: {
    clientId: process.env.IMGUR_CLIENT_ID,
    clientSecret: process.env.IMGUR_CLIENT_SECRET,
    refreshToken: process.env.IMGUR_REFRESH_TOKEN,
    // rapidApiKey: process.env.RAPID_API_KEY ?? undefined,
    // hash: process.env.IMGUR_HASH,
  },
  sanity: {
    useCdn: false,
    token: process.env.SANITY_ACCESS_TOKEN,
    projectId: process.env.SANITY_PROJECT_ID,
    dataset: process.env.SANITY_DATASET,
  },
  reddit: {
    subreddit: process.env.REDDIT_SUBREDDIT
      ? process.env.REDDIT_SUBREDDIT
      : "cyclepdx",
    clientId: process.env.REDDIT_CLIENT_ID,
    clientSecret: process.env.REDDIT_CLIENT_SECRET,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD,
  },
  googleApiKey: process.env.GOOGLE_API_KEY,
};

const biketag = new BikeTagClient(opts);
import axios from "axios";

const updateAlbumPrivacy = (album: any, privacy = 'public') => {
  var form = new FormData();
  form.append("privacy", privacy);
  return axios({
    url: `https://api.imgur.com/3/album/${album.id}?privacy=public`,
    headers: {
      'Authorization': "Bearer 6db445db7d630d1f74afbec4555dd0bac74e752c",
      'Content-Type': 'multipart/form-data',
    },
    data: form,
    method: "PUT",
  })
}

updateAlbumPrivacy({id: '3uojgVr'})
updateAlbumPrivacy({id: 'WBP8Ddm'})
updateAlbumPrivacy({id: 'WBP8Ddm'})

const updateBikeTagImgurAlbums = async (client: BikeTagClient) => {
  /// Get game data from the API
  const sanityResponse = await client.getGame(opts.game, { source: "sanity" });
  const game = sanityResponse.data;

  if (!game) {
    return console.log("no game, no dice", opts, sanityResponse);
  }

  /// Get the album from imgur, if it does not exist then create a new one and update the game?
  const mainAlbum = await client.images().getAlbum(game.mainhash!);
  const queueAlbum = await client.images().getAlbum(game.queuehash!);

  console.log({ mainAlbum, queueAlbum });

  // if (mainAlbum.success) {
  //   const mainUpdate = await updateAlbumPrivacy(mainAlbum.data)
  //   console.log({ mainUpdate })
  // }
  // if (queueAlbum.success) {
  //   const queueUpdate = await updateAlbumPrivacy(queueAlbum.data)
  //   console.log({ queueUpdate })
  // }
}

updateBikeTagImgurAlbums(biketag)
