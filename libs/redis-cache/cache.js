// utils/cache.js
const Redis = require("ioredis");
const db = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');

const redis = new Redis({
    host: "127.0.0.1",
    port: 6379,
});

// ------------------
// Generic Cache Wrapper
// ------------------
async function cachedQuery(query, params = [], ttl = 300) {
    const cacheKey = JSON.stringify({ query, params });

    try {
        // 1. Try cache
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
            logger.info("✅ Cache hit");
            return JSON.parse(cachedData);
        }
    } catch (err) {
        logger.error("⚠️ Redis unavailable, fallback to DB only", err);
    }

    // 2. DB query
    logger.info("⚡ DB hit");
    const result = await db.query(query, params);
//  logger.info("⚡ DB hit %o",result.rows);
    try {
        // 3. Save in cache with TTL
        await redis.set(cacheKey, JSON.stringify(result.rows), "EX", ttl);
        logger.info(`📝 Cached result with TTL = ${ttl} seconds`);
    } catch (err) {
        logger.error("⚠️ Failed to cache result in Redis");
    }

    return result.rows;
}

// ------------------
// Helper: Invalidate a cache key
// ------------------
async function invalidateCache(query, params = []) {
    const cacheKey = JSON.stringify({ query, params });
    try {
        await redis.del(cacheKey);
        logger.info("🗑️ Cache invalidated: %o", cacheKey);
    } catch (err) {
        logger.info("⚠️ Redis unavailable, could not invalidate");
    }
}

// ------------------
// Helper: Clear all cache
// ------------------
async function clearCache() {
    try {
        await redis.flushall();
        logger.info("🧹 All cache cleared");
    } catch (err) {
        logger.error("⚠️ Redis unavailable, could not clear cache");
    }
}


// ------------------
// Cache for any data (not just DB)
// ------------------
async function cacheGetOrSet(key, fetchFunction, ttl = 60) {
    try {
      
        // 1. Try cache
        const cachedData = await redis.get(key);
        if (cachedData) {
            logger.info(`✅ Cache hit for key: ${key}`);
            return JSON.parse(cachedData);
        }
    } catch (err) {
        logger.error("⚠️ Redis unavailable, fallback only", err);
    }

    // 2. Call the fetch function
    const freshData = await fetchFunction();

    try {
        // 3. Save in cache
        await redis.set(key, JSON.stringify(freshData), "EX", ttl);
        logger.info(`📝 Cached key ${key} with TTL = ${ttl} seconds`);
    } catch (err) {
        logger.error("⚠️ Failed to cache result in Redis", err);
    }

    return freshData;
    
}

module.exports = {
    cachedQuery,
    invalidateCache,
    clearCache,
    cacheGetOrSet
};
