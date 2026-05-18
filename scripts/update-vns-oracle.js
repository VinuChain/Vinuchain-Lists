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
const REQUIRE_POOL_GUARD =
  SHOULD_SEND ||
  process.env.VNS_ORACLE_REQUIRE_POOL_GUARD === '1' ||
  process.argv.includes('--require-pool-guard');
const ALLOW_SINGLE_SOURCE =
  process.env.VNS_ORACLE_ALLOW_SINGLE_SOURCE === '1' ||
  process.argv.includes('--allow-single-source');

const COINGECKO_MAX_AGE_SECONDS = Number(
  process.env.VNS_COINGECKO_MAX_AGE_SECONDS || 15 * 60,
);
const TWAP_WINDOW_SECONDS = Number(
  process.env.VNS_ORACLE_TWAP_WINDOW_SECONDS || 10 * 60,
);
const TWAP_WINDOWS_SECONDS = Array.from(
  new Set(
    [
      TWAP_WINDOW_SECONDS,
      5 * 60,
      2 * 60,
      60,
      30,
    ].filter((seconds) => Number.isFinite(seconds) && seconds > 0),
  ),
).sort((a, b) => b - a);
const MAX_DEVIATION_BPS = Number(process.env.VNS_ORACLE_MAX_DEVIATION_BPS || 1000);
const MAX_UPDATE_BPS = Number(process.env.VNS_ORACLE_MAX_UPDATE_BPS || 2000);
const EXPECTED_ORACLE_MAX_AGE = BigInt(
  process.env.VNS_EXPECTED_ORACLE_MAX_AGE_SECONDS || 24 * 60 * 60,
);
const MIN_POOL_LIQUIDITY = BigInt(
  process.env.VNS_ORACLE_MIN_POOL_LIQUIDITY || '1000000000000',
);

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
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
  'function latestStoredAnswer() external view returns (int256)',
  'function maxAge() view returns (uint256)',
  'function maxAnswer() view returns (uint256)',
  'function maxChangeBps() view returns (uint256)',
  'function minAnswer() view returns (uint256)',
  'function owner() view returns (address)',
  'function source() external view returns (string)',
  'function updatedAt() external view returns (uint256)',
  'function version() view returns (uint256)',
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
  const [token0Address, token1Address, liquidity] = await Promise.all([
    contract.token0(),
    contract.token1(),
    contract.liquidity(),
  ]);
  if (liquidity < MIN_POOL_LIQUIDITY) {
    throw new Error(`${pool.label} liquidity below minimum`);
  }

  let observed = null;
  let windowSeconds = null;
  let lastError = null;
  for (const candidateWindow of TWAP_WINDOWS_SECONDS) {
    try {
      observed = await contract.observe([candidateWindow, 0]);
      windowSeconds = candidateWindow;
      break;
    } catch (error) {
      lastError = error;
      if (!String(error?.message || error).includes('OLD')) {
        throw error;
      }
    }
  }
  if (!observed || !windowSeconds) {
    throw lastError || new Error(`${pool.label} TWAP observe failed`);
  }

  const tickCumulatives = observed[0];
  const tickDelta = tickCumulatives[1] - tickCumulatives[0];
  const avgTick = Number(divFloor(tickDelta, BigInt(windowSeconds)));
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
    windowSeconds,
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

function deviationBpsBigInt(a, b) {
  const delta = a > b ? a - b : b - a;
  return (delta * 10_000n) / a;
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

async function resolveVnsOraclePrice() {
  const [coingeckoResult, poolResult] = await Promise.allSettled([
    fetchCoinGeckoPrice(),
    fetchPoolPrice(),
  ]);
  const coingecko =
    coingeckoResult.status === 'fulfilled' ? coingeckoResult.value : null;
  const pool = poolResult.status === 'fulfilled' ? poolResult.value : null;
  const coingeckoError =
    coingeckoResult.status === 'rejected' ? coingeckoResult.reason?.message : null;
  const poolError = poolResult.status === 'rejected' ? poolResult.reason?.message : null;

  if (coingecko && pool) {
    const deviation = deviationBps(coingecko.usd, pool.usd);
    if (deviation > MAX_DEVIATION_BPS) {
      throw new Error(
        `CoinGecko/V3 TWAP deviation ${deviation.toFixed(1)} bps exceeds ${MAX_DEVIATION_BPS}`,
      );
    }
    return {
      usd: coingecko.usd,
      source: 'coingecko+v3-twap',
      updatedAt: coingecko.updatedAt,
      priceChainId: pool.priceChainId,
      deviationBps: Math.round(deviation),
      poolDeviationBps: pool.deviationBps,
      coingeckoUsd: coingecko.usd,
      poolUsd: pool.usd,
      pools: pool.pools,
    };
  }

  if (coingecko) {
    if (REQUIRE_POOL_GUARD && !ALLOW_SINGLE_SOURCE) {
      throw new Error(
        `CoinGecko price is available but V3 TWAP guard failed: ${poolError || 'no pool price'}`,
      );
    }
    return { ...coingecko, poolError };
  }

  if (pool) {
    if (REQUIRE_POOL_GUARD && !ALLOW_SINGLE_SOURCE) {
      throw new Error(
        `V3 TWAP fallback is available but CoinGecko guard failed: ${coingeckoError || 'no CoinGecko price'}`,
      );
    }
    return { ...pool, coingeckoError };
  }

  throw new Error('Unable to price VC from CoinGecko or guarded V3 TWAP pools');
}

async function verifyOracleForUpdate(provider, signer, oracle, answer) {
  const address = await oracle.getAddress();
  const code = await provider.getCode(address);
  if (code === '0x') {
    throw new Error(`No contract code at ${address}`);
  }

  const [
    owner,
    decimals,
    description,
    version,
    maxAge,
    minAnswer,
    maxAnswer,
    maxChangeBps,
    previousAnswer,
  ] = await Promise.all([
    oracle.owner(),
    oracle.decimals(),
    oracle.description(),
    oracle.version(),
    oracle.maxAge(),
    oracle.minAnswer(),
    oracle.maxAnswer(),
    oracle.maxChangeBps(),
    oracle.latestStoredAnswer(),
  ]);
  const signerAddress = await signer.getAddress();
  if (owner.toLowerCase() !== signerAddress.toLowerCase()) {
    throw new Error(`Oracle owner is ${owner}; signer is ${signerAddress}`);
  }
  if (decimals !== 8n && decimals !== 8) {
    throw new Error(`Oracle decimals is ${decimals}; expected 8`);
  }
  if (description !== 'VC / USD') {
    throw new Error(`Oracle description is ${description}; expected VC / USD`);
  }
  if (version !== 1n && version !== 1) {
    throw new Error(`Oracle version is ${version}; expected 1`);
  }
  if (maxAge !== EXPECTED_ORACLE_MAX_AGE) {
    throw new Error(
      `Oracle maxAge is ${maxAge}; expected ${EXPECTED_ORACLE_MAX_AGE}`,
    );
  }
  if (answer < minAnswer || answer > maxAnswer) {
    throw new Error(`Answer ${answer} outside oracle bounds ${minAnswer}-${maxAnswer}`);
  }
  if (previousAnswer > 0n) {
    const updateBps = deviationBpsBigInt(previousAnswer, answer);
    const allowedBps =
      maxChangeBps < BigInt(MAX_UPDATE_BPS) ? maxChangeBps : BigInt(MAX_UPDATE_BPS);
    if (updateBps > allowedBps) {
      throw new Error(
        `Answer update deviation ${updateBps} bps exceeds ${allowedBps}`,
      );
    }
  }
}

async function main() {
  const targetProvider = new JsonRpcProvider(TARGET_RPC_URL);
  const targetChainId = await assertChain(
    targetProvider,
    EXPECTED_TARGET_CHAIN_ID,
    'target oracle',
  );
  const price = await resolveVnsOraclePrice();

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
        coingeckoUsd: price.coingeckoUsd ?? null,
        poolUsd: price.poolUsd ?? null,
        requirePoolGuard: REQUIRE_POOL_GUARD,
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
  await verifyOracleForUpdate(targetProvider, signer, oracle, answer);
  const tx = await oracle.setLatestAnswer(answer, price.source);
  console.log(`submitted ${tx.hash}`);
  await tx.wait();
  console.log('confirmed');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = {
  assertChain,
  fetchCoinGeckoPrice,
  fetchPoolPrice,
  resolveVnsOraclePrice,
  toOracleAnswer,
};
