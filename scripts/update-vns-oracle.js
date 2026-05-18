#!/usr/bin/env node

const { Contract, JsonRpcProvider, Wallet } = require('ethers');

const TARGET_RPC_URL =
  process.env.VNS_ORACLE_RPC_URL ||
  process.env.VINUCHAIN_RPC_URL ||
  'https://vinufoundation-rpc.com';
const EXPECTED_TARGET_CHAIN_ID = Number(process.env.VNS_ORACLE_CHAIN_ID || 206);
const PRICE_RPC_URL = process.env.VNS_PRICE_RPC_URL || 'https://vinuchain-rpc.com';
const EXPECTED_PRICE_CHAIN_ID = Number(process.env.VNS_PRICE_CHAIN_ID || 207);
const ORACLE_ADDRESS = process.env.VNS_USD_ORACLE_ADDRESS;
const PRIVATE_KEY = process.env.VNS_ORACLE_PRIVATE_KEY;
const SHOULD_SEND = process.argv.includes('--send');
const DISABLE_COINGECKO =
  process.env.VNS_ORACLE_DISABLE_COINGECKO === '1' ||
  process.argv.includes('--no-coingecko');

const COINGECKO_MAX_AGE_SECONDS = Number(
  process.env.VNS_COINGECKO_MAX_AGE_SECONDS || 15 * 60,
);
const TWAP_WINDOW_SECONDS = Number(
  process.env.VNS_ORACLE_TWAP_WINDOW_SECONDS || 10 * 60,
);
const MAX_DEVIATION_BPS = Number(process.env.VNS_ORACLE_MAX_DEVIATION_BPS || 1000);
const MIN_POOL_LIQUIDITY = BigInt(process.env.VNS_ORACLE_MIN_POOL_LIQUIDITY || '1');

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=vinuchain&vs_currencies=usd&include_last_updated_at=true';

const V3_POOL_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function liquidity() view returns (uint128)',
  'function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)',
];
const ORACLE_ABI = [
  'function setLatestAnswer(int256 newAnswer, string newSource) external',
  'function latestStoredAnswer() external view returns (int256)',
  'function source() external view returns (string)',
  'function updatedAt() external view returns (uint256)',
];

const POOLS = {
  vcUsdt: {
    label: 'WVC/USDT',
    token0: 'WVC',
    token1: 'USDT',
    token0Address: '0xed8c5530a0a086a12f57275728128a60dff04230',
    token1Address: '0xc0264277fcca5fcfabd41a8bc01c1fcaf8383e41',
    token0Decimals: 18,
    token1Decimals: 6,
    poolAddress: '0xa97FA6E9A764306107F2103a2024Cfe660c5dA33',
  },
  vinuVc: {
    label: 'VINU/WVC',
    token0: 'VINU',
    token1: 'WVC',
    token0Address: '0x00c1e515ea9579856304198efb15f525a0bb50f6',
    token1Address: '0xed8c5530a0a086a12f57275728128a60dff04230',
    token0Decimals: 18,
    token1Decimals: 18,
    poolAddress: '0xd50ee26F62B1825d14e22e23747939D96746434c',
  },
  vinuUsdt: {
    label: 'VINU/USDT',
    token0: 'VINU',
    token1: 'USDT',
    token0Address: '0x00c1e515ea9579856304198efb15f525a0bb50f6',
    token1Address: '0xc0264277fcca5fcfabd41a8bc01c1fcaf8383e41',
    token0Decimals: 18,
    token1Decimals: 6,
    poolAddress: '0x3424b0dd7715C8db92414DB0c5A9E5FA0D51cCb5',
  },
};

async function assertChain(provider, expectedChainId, label) {
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== expectedChainId) {
    throw new Error(
      `${label} RPC is chain ${chainId}; expected ${expectedChainId}`,
    );
  }
  return chainId;
}

async function fetchCoinGeckoPrice() {
  if (DISABLE_COINGECKO) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(COINGECKO_URL, { signal: controller.signal });
    if (!response.ok) return null;
    const body = await response.json();
    const payload = body?.vinuchain;
    const usd = payload?.usd;
    const updatedAt = payload?.last_updated_at;
    const now = Math.floor(Date.now() / 1000);
    if (
      typeof usd !== 'number' ||
      !Number.isFinite(usd) ||
      usd <= 0 ||
      typeof updatedAt !== 'number' ||
      now - updatedAt > COINGECKO_MAX_AGE_SECONDS
    ) {
      return null;
    }
    return { usd, source: 'coingecko', updatedAt };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function divFloor(numerator, denominator) {
  let quotient = numerator / denominator;
  if (numerator < 0n && numerator % denominator !== 0n) {
    quotient -= 1n;
  }
  return quotient;
}

function tokenMeta(pool, address) {
  const lower = address.toLowerCase();
  if (lower === pool.token0Address.toLowerCase()) {
    return { symbol: pool.token0, decimals: pool.token0Decimals };
  }
  if (lower === pool.token1Address.toLowerCase()) {
    return { symbol: pool.token1, decimals: pool.token1Decimals };
  }
  throw new Error(`${pool.label} returned unexpected token ${address}`);
}

async function readPoolTwap(provider, pool) {
  const contract = new Contract(pool.poolAddress, V3_POOL_ABI, provider);
  const [token0Address, token1Address, liquidity, observed] = await Promise.all([
    contract.token0(),
    contract.token1(),
    contract.liquidity(),
    contract.observe([TWAP_WINDOW_SECONDS, 0]),
  ]);
  if (liquidity < MIN_POOL_LIQUIDITY) {
    throw new Error(`${pool.label} liquidity below minimum`);
  }

  const tickCumulatives = observed[0];
  const tickDelta = tickCumulatives[1] - tickCumulatives[0];
  const avgTick = Number(divFloor(tickDelta, BigInt(TWAP_WINDOW_SECONDS)));
  const token0 = tokenMeta(pool, token0Address);
  const token1 = tokenMeta(pool, token1Address);
  const token1PerToken0 =
    Math.pow(1.0001, avgTick) * 10 ** (token0.decimals - token1.decimals);

  if (!Number.isFinite(token1PerToken0) || token1PerToken0 <= 0) {
    throw new Error(`${pool.label} produced invalid TWAP`);
  }

  return {
    label: pool.label,
    token0: token0.symbol,
    token1: token1.symbol,
    token1PerToken0,
    liquidity: liquidity.toString(),
  };
}

function quote(quoteData, base, counter) {
  if (quoteData.token0 === base && quoteData.token1 === counter) {
    return quoteData.token1PerToken0;
  }
  if (quoteData.token0 === counter && quoteData.token1 === base) {
    return 1 / quoteData.token1PerToken0;
  }
  return null;
}

function deviationBps(a, b) {
  return (Math.abs(a - b) / ((a + b) / 2)) * 10_000;
}

async function fetchPoolPrice() {
  const provider = new JsonRpcProvider(PRICE_RPC_URL);
  const priceChainId = await assertChain(
    provider,
    EXPECTED_PRICE_CHAIN_ID,
    'VinuSwap price',
  );
  const [vcUsdt, vinuVc, vinuUsdt] = await Promise.all([
    readPoolTwap(provider, POOLS.vcUsdt),
    readPoolTwap(provider, POOLS.vinuVc),
    readPoolTwap(provider, POOLS.vinuUsdt),
  ]);

  const direct = quote(vcUsdt, 'WVC', 'USDT');
  const vinuUsd = quote(vinuUsdt, 'VINU', 'USDT');
  const vinuWvc = quote(vinuVc, 'VINU', 'WVC');
  const cross = vinuUsd && vinuWvc ? vinuUsd / vinuWvc : null;
  if (!direct || !cross) {
    throw new Error('Unable to derive guarded V3 TWAP VC/USD price');
  }

  const deviation = deviationBps(direct, cross);
  if (deviation > MAX_DEVIATION_BPS) {
    throw new Error(
      `V3 TWAP price deviation ${deviation.toFixed(1)} bps exceeds ${MAX_DEVIATION_BPS}`,
    );
  }

  return {
    usd: direct,
    source: 'v3-twap',
    priceChainId,
    deviationBps: Math.round(deviation),
    pools: [vcUsdt, vinuVc, vinuUsdt],
  };
}

function toOracleAnswer(usd) {
  const scaled = Math.round(usd * 1e8);
  if (!Number.isSafeInteger(scaled) || scaled <= 0) {
    throw new Error(`Invalid VC/USD price: ${usd}`);
  }
  return BigInt(scaled);
}

async function main() {
  const targetProvider = new JsonRpcProvider(TARGET_RPC_URL);
  const targetChainId = await assertChain(
    targetProvider,
    EXPECTED_TARGET_CHAIN_ID,
    'target oracle',
  );
  const price = (await fetchCoinGeckoPrice()) || (await fetchPoolPrice());

  if (!price) {
    throw new Error('Unable to price VC from CoinGecko or guarded V3 TWAP pools');
  }

  const answer = toOracleAnswer(price.usd);
  console.log(
    JSON.stringify(
      {
        vcUsd: price.usd,
        oracleAnswer: answer.toString(),
        source: price.source,
        targetChainId,
        priceChainId: price.priceChainId || null,
        deviationBps: price.deviationBps ?? null,
        mode: SHOULD_SEND ? 'send' : 'dry-run',
      },
      null,
      2,
    ),
  );

  if (!SHOULD_SEND) return;
  if (!ORACLE_ADDRESS) throw new Error('Set VNS_USD_ORACLE_ADDRESS');
  if (!PRIVATE_KEY) throw new Error('Set VNS_ORACLE_PRIVATE_KEY');

  const signer = new Wallet(PRIVATE_KEY, targetProvider);
  const oracle = new Contract(ORACLE_ADDRESS, ORACLE_ABI, signer);
  const tx = await oracle.setLatestAnswer(answer, price.source);
  console.log(`submitted ${tx.hash}`);
  await tx.wait();
  console.log('confirmed');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
