
import dotenv from 'dotenv'
import { BikeTagClient } from 'biketag'
import { getGamePayload } from 'biketag/lib/common/payloads'

dotenv.config()

const opts = {
    game: process.env.BIKETAG_GAME ?? 'test',
    imgur: {
      clientId: process.env.IMGUR_CLIENT_ID,
      clientSecret: process.env.IMGUR_CLIENT_SECRET,
      hash: process.env.IMGUR_HASH,
    },
    reddit: {
      clientId: process.env.REDDIT_CLIENT_ID,
      clientSecret: process.env.REDDIT_CLIENT_SECRET,
      username: process.env.REDDIT_USERNAME,
      password: process.env.REDDIT_PASSWORD,
    },
    sanity: {
      useCdn: false,
      token: process.env.SANITY_ACCESS_TOKEN,
      projectId: process.env.SANITY_PROJECT_ID,
      dataset: process.env.SANITY_DATASET,
    },
  }
  const fromClass = new BikeTagClient(opts)
  
  const testBikeTag = async (client: BikeTagClient) => {
    /// Get game data from the API
    const game = await client.game(opts as unknown as getGamePayload)
    
    /// Set and get the new configuration using the mainhash from the game
    const config =  opts

    console.log({ config })
    
    /// get tag number 1
    // const {data: tags} = await client.tags({ tagnumbers: [], game: opts.game, limit: 1000, time: 'all', subreddit: game.subreddit }, { source: 'reddit' })
    const tags = await client.tags({ limit: 10 })
    const players = await client.players({ limit: 10 })

    console.log({ game, tags, players })
  }
  
  testBikeTag(fromClass)