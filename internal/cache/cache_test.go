package cache

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestCacheSetGetOverwriteFlush(t *testing.T) {
	c := New[int](DefaultTTL)

	if _, ok := c.Get("missing"); ok {
		t.Fatal("expected missing key to return false")
	}

	c.Set("a", 1)
	if v, ok := c.Get("a"); !ok || v != 1 {
		t.Fatalf("got (%v, %v), want (1, true)", v, ok)
	}

	// Overwrite
	c.Set("a", 2)
	if v, ok := c.Get("a"); !ok || v != 2 {
		t.Fatalf("got (%v, %v), want (2, true)", v, ok)
	}

	// Flush
	c.Flush()
	if _, ok := c.Get("a"); ok {
		t.Fatal("expected flushed key to be absent")
	}
}

func TestCacheTTLExpiryAndPrune(t *testing.T) {
	now := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	c := New[string](5 * time.Minute)
	c.now = func() time.Time { return now }

	c.Set("default", "v1")
	c.SetWithTTL("short", "v2", 10*time.Second)
	c.SetWithTTL("forever", "v3", 0)

	// Advance 9s: all should still be present
	now = now.Add(9 * time.Second)
	if v, ok := c.Get("short"); !ok || v != "v2" {
		t.Fatalf("expected short to still be valid at 9s, got (%q, %v)", v, ok)
	}

	// Advance 1s (total 10s): short expires
	now = now.Add(1 * time.Second)
	if _, ok := c.Get("short"); ok {
		t.Fatal("expected short to be expired at 10s")
	}
	if v, ok := c.Get("default"); !ok || v != "v1" {
		t.Fatalf("expected default to still be valid at 10s, got (%q, %v)", v, ok)
	}

	// Advance past 5 minutes: default expires, forever remains
	now = now.Add(5 * time.Minute)
	if removed := c.Prune(); removed != 1 {
		t.Fatalf("expected Prune to remove 1 expired entry, removed %d", removed)
	}
	if _, ok := c.Get("default"); ok {
		t.Fatal("expected default to be expired after 5m")
	}
	if v, ok := c.Get("forever"); !ok || v != "v3" {
		t.Fatalf("expected forever to remain, got (%q, %v)", v, ok)
	}
}

func TestCacheConcurrentAccess(t *testing.T) {
	c := New[int](50 * time.Millisecond)

	var wg sync.WaitGroup
	for g := 0; g < 16; g++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for i := 0; i < 200; i++ {
				key := fmt.Sprintf("k-%d", i%20)
				switch i % 4 {
				case 0:
					c.Set(key, id*1000+i)
				case 1:
					c.Get(key)
				case 2:
					c.SetWithTTL(key, i, 5*time.Millisecond)
				case 3:
					c.Prune()
				}
			}
		}(g)
	}
	wg.Wait()
	c.Flush()
}
