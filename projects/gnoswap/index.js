const { get } = require('../helper/http')
const { transformDexBalances } = require('../helper/portedTokens')

const RPC = 'https://rpc.gno.land'
const POOL_REALM = 'gno.land/r/gnoswap/pool'
const GOV_STAKER_REALM = 'gno.land/r/gnoswap/gov/staker'

// pool path format: "<token0>:<token1>:<fee>"
const WUGNOT_GNS_POOL = 'gno.land/r/gnoland/wugnot.wugnot:gno.land/r/gnoswap/gns.GNS:3000'
const POOLS = [WUGNOT_GNS_POOL]

// Evaluates a read-only expression on a Gno.land realm and returns the raw text result
async function qeval(realm, expr) {
  const data = '0x' + Buffer.from(`${realm}.${expr}`).toString('hex')
  const { result } = await get(`${RPC}/abci_query?path="vm/qeval"&data=${data}`)
  const { Error: error, Data } = result.response.ResponseBase
  if (error) throw new Error(`qeval ${realm}.${expr} failed: ${JSON.stringify(error)}`)
  return Buffer.from(Data, 'base64').toString()
}

async function tvl(api) {
  const data = []
  for (const poolPath of POOLS) {
    const [token0, token1] = poolPath.split(':')
    const [token0Bal, token1Bal] = [...(await qeval(POOL_REALM, `GetBalances("${poolPath}")`)).matchAll(/\((-?\d+) int64\)/g)].map(m => m[1])
    data.push({ token0, token0Bal, token1, token1Bal })
  }
  return transformDexBalances({ api, data })
}

// GNS has no CoinGecko listing, so staked GNS is valued in GNOT using the wugnot/GNS pool price
async function staking(api) {
  const staked = +(await qeval(GOV_STAKER_REALM, 'GetTotalDelegated()')).match(/^\((\d+) int64\)/)[1]
  const sqrtPriceX96 = BigInt((await qeval(POOL_REALM, `GetSlot0SqrtPriceX96("${WUGNOT_GNS_POOL}")`)).match(/^\("(\d+)" string\)/)[1])
  const gnsPerGnot = Number(sqrtPriceX96 * sqrtPriceX96 * 10n ** 18n / 2n ** 192n) / 1e18 // token1 (GNS) per token0 (wugnot), both 6 decimals
  api.addCGToken('gno-land', staked / gnsPerGnot / 1e6)
}

module.exports = {
  misrepresentedTokens: true,
  methodology: 'TVL counts the tokens in the GnoSwap wugnot/GNS pool on Gno.land. Staking counts GNS delegated in GnoSwap governance, valued in GNOT at the wugnot/GNS pool price. All data is read on-chain from the GnoSwap realms.',
  gnoland: {
    tvl,
    staking,
  },
}
