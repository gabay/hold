package cache

import (
	"sync"
	"time"
)

// DefaultTTL matches the 5-minute TTL used by the TypeScript NodeCache instance.
const DefaultTTL = 5 * time.Minute

type entry[V any] struct {
	value     V
	expiresAt time.Time
}

// Cache is a generic, thread-safe in-memory TTL cache.
type Cache[V any] struct {
	mu         sync.RWMutex
	defaultTTL time.Duration
	entries    map[string]entry[V]
	now        func() time.Time
}

// New creates a Cache with the given default TTL.
// If defaultTTL <= 0, DefaultTTL (5 minutes) is used.
func New[V any](defaultTTL time.Duration) *Cache[V] {
	if defaultTTL <= 0 {
		defaultTTL = DefaultTTL
	}
	return &Cache[V]{
		defaultTTL: defaultTTL,
		entries:    make(map[string]entry[V]),
		now:        time.Now,
	}
}

// Get returns the cached value for key if present and not expired.
func (c *Cache[V]) Get(key string) (V, bool) {
	now := c.now()

	c.mu.RLock()
	e, ok := c.entries[key]
	if !ok {
		c.mu.RUnlock()
		var zero V
		return zero, false
	}
	expired := !e.expiresAt.IsZero() && !now.Before(e.expiresAt)
	val := e.value
	c.mu.RUnlock()

	if !expired {
		return val, true
	}

	// Lazily remove expired entry under write lock after re-checking.
	c.mu.Lock()
	if e2, ok := c.entries[key]; ok && !e2.expiresAt.IsZero() && !c.now().Before(e2.expiresAt) {
		delete(c.entries, key)
	}
	c.mu.Unlock()

	var zero V
	return zero, false
}

// Set stores val under key using the cache's default TTL.
func (c *Cache[V]) Set(key string, val V) {
	c.SetWithTTL(key, val, c.defaultTTL)
}

// SetWithTTL stores val under key with a custom TTL.
// A non-positive ttl stores the entry without expiration.
func (c *Cache[V]) SetWithTTL(key string, val V, ttl time.Duration) {
	var exp time.Time
	if ttl > 0 {
		exp = c.now().Add(ttl)
	}
	c.mu.Lock()
	c.entries[key] = entry[V]{
		value:     val,
		expiresAt: exp,
	}
	c.mu.Unlock()
}

// Flush removes all entries from the cache.
func (c *Cache[V]) Flush() {
	c.mu.Lock()
	clear(c.entries)
	c.mu.Unlock()
}

// Prune removes all expired entries and returns the number removed.
func (c *Cache[V]) Prune() int {
	now := c.now()
	removed := 0
	c.mu.Lock()
	for k, e := range c.entries {
		if !e.expiresAt.IsZero() && !now.Before(e.expiresAt) {
			delete(c.entries, k)
			removed++
		}
	}
	c.mu.Unlock()
	return removed
}
