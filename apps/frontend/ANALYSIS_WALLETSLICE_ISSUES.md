# Analysis: What Broke in walletSlice Implementation (Commit 9376e82)

## Executive Summary

The walletSlice implementation introduced infinite loops and page freezes due to **unstable selectors** that called `Date.now()` on every render, combined with **useEffect dependencies on selector results** that changed on every render cycle.

## Root Cause #1: Unstable Selectors with Date.now()

### The Problem

In `walletSlice.ts`, the `selectWallet` selector was implemented as:

```typescript
export const selectWallet = (state: { wallet: WalletState }, channelSlug: string): Wallet | null => {
  const entry = state.wallet.wallets[channelSlug];
  if (!entry) return null;
  
  // PROBLEM: Date.now() is called on EVERY selector invocation
  const now = Date.now();
  if (now - entry.timestamp > WALLET_CACHE_TTL) {
    return null; // Cache expired
  }
  
  return entry.data;
};
```

### Why This Causes Infinite Loops

1. **React re-render cycle**: Every time a component re-renders, `useAppSelector` calls the selector function
2. **Date.now() returns new value**: Each call to `Date.now()` returns a different number (even milliseconds apart)
3. **Selector appears to return new value**: Even though the wallet `data` hasn't changed, the selector function itself changes on every call
4. **React's reference equality**: `useAppSelector` uses shallow equality check. If the selector function reference changes, React thinks the value changed
5. **Cascade effect**: Component re-renders → selector runs → Date.now() → React sees "change" → component re-renders again → infinite loop

### Visual Flow

```
Component Render
    ↓
useAppSelector(selectWallet) called
    ↓
selectWallet() executes → calls Date.now()
    ↓
Date.now() returns NEW value (e.g., 1703001234567)
    ↓
React compares selector result (uses memoization internally)
    ↓
Even if wallet.data is same, selector execution context is "new"
    ↓
React triggers re-render
    ↓
[LOOP REPEATS]
```

### Code Example: Working vs Broken

**Working Version (94eb6ed)** - Uses local state:
```typescript
const [wallet, setWallet] = useState<Wallet | null>(null);

useEffect(() => {
  // Load wallet once, store in local state
  // setWallet is stable, no infinite loops
}, [/* stable dependencies */]);
```

**Broken Version (9376e82)** - Uses unstable selector:
```typescript
const reduxWallet = useAppSelector((state) => 
  targetChannelSlugForWallet ? selectWallet(state, targetChannelSlugForWallet) : null
);

// Problem: selectWallet calls Date.now() internally
// Every render → Date.now() returns new value → selector "changes" → re-render
```

## Root Cause #2: useEffect Dependencies on Selector Results

### The Problem

In `Header.tsx` and `StreamerProfile.tsx`, useEffect was made dependent on selector results:

```typescript
// Header.tsx - BROKEN
useEffect(() => {
  if (reduxWallet) {
    return; // Wallet already loaded
  }
  if (walletLoading) {
    return;
  }
  dispatch(fetchWallet({ channelSlug: targetChannelSlugForWallet }));
}, [user, targetChannelSlugForWallet, reduxWallet, walletLoading, dispatch, location.pathname]);
//                                 ^^^^^^^^^^^^  ^^^^^^^^^^^^^^
//                                 UNSTABLE DEPENDENCIES
```

### Why This Amplifies the Problem

1. **Circular dependency**: 
   - useEffect depends on `reduxWallet`
   - `reduxWallet` comes from unstable selector (Issue #1)
   - Selector changes → `reduxWallet` changes → useEffect runs
   - useEffect might dispatch action → Redux updates → selector runs again → loop

2. **Cascading re-renders**:
   - Component renders
   - Unstable selector returns "new" value
   - useEffect sees dependency change
   - useEffect executes, might dispatch
   - Redux updates
   - Component re-renders (due to Redux update)
   - Selector runs again → returns "new" value
   - Infinite loop

### Code Example: Working vs Broken

**Working Version (94eb6ed)** - Uses refs and stable dependencies:
```typescript
const walletLoadedRef = useRef<string | null>(null);

useEffect(() => {
  // Check ref instead of depending on selector result
  if (walletLoadedRef.current === targetChannelSlug) {
    return; // Already loaded
  }
  
  // Use ref to track, not selector result
  walletLoadedRef.current = targetChannelSlug;
  dispatch(fetchWallet(...));
}, [user, targetChannelSlug, dispatch]); // Stable dependencies only
```

**Broken Version (9376e82)** - Depends on unstable selector:
```typescript
useEffect(() => {
  if (reduxWallet) { // ← Depends on unstable selector result
    return;
  }
  dispatch(fetchWallet(...));
}, [user, reduxWallet, walletLoading, ...]); // ← Unstable dependencies
```

## Root Cause #3: submissions.length in Dependencies

### The Problem

In `Header.tsx`, `Dashboard.tsx`, and `Admin.tsx`, `submissions.length` was added to useEffect dependencies:

```typescript
useEffect(() => {
  const hasSubmissions = submissions.length > 0;
  const shouldLoad = !hasSubmissions && !submissionsLoading;
  if (shouldLoad) {
    dispatch(fetchSubmissions({ status: 'pending' }));
  }
}, [user, user?.role, user?.channelId, submissions.length, submissionsLoading, dispatch]);
//                                              ^^^^^^^^^^^^^^^^^^
//                                              PROBLEMATIC
```

### Why This Causes Issues

1. **Array reference changes**: Even if the length is the same, the array reference might change
2. **Redux array updates**: When Redux updates submissions array, it creates a new array reference
3. **Combined with unstable selectors**: This amplifies the infinite loop problem

### Code Example: Working vs Broken

**Working Version (94eb6ed)** - Uses ref to track:
```typescript
const submissionsLoadedRef = useRef(false);

useEffect(() => {
  if (submissionsLoadedRef.current) {
    return; // Already attempted
  }
  if (submissions.length === 0 && !submissionsLoading) {
    submissionsLoadedRef.current = true;
    dispatch(fetchSubmissions({ status: 'pending' }));
  }
}, [user, user?.role, user?.channelId, submissionsLoading, dispatch]);
// No submissions.length dependency - uses ref instead
```

**Broken Version (9376e82)** - Depends on array length:
```typescript
useEffect(() => {
  const hasSubmissions = submissions.length > 0;
  // ...
}, [user, submissions.length, submissionsLoading, dispatch]);
//                ^^^^^^^^^^^^^^^^^^
//                Array reference changes → useEffect runs → might dispatch → array changes → loop
```

## Root Cause #4: Missing Refs for Loading State Tracking

### The Problem

The working version used `useRef` to track loading attempts:

```typescript
// WORKING - 94eb6ed
const submissionsLoadedRef = useRef(false);
const walletLoadedRef = useRef<string | null>(null);
```

But the broken version removed these refs and relied on Redux state and selectors instead.

### Why Refs Are Important

1. **Refs persist across renders** but don't trigger re-renders when they change
2. **Prevents duplicate dispatches**: Once a ref is set, we know we've attempted to load
3. **Breaks circular dependencies**: Ref changes don't cause useEffect to re-run

### The Cascade Without Refs

```
1. Component renders
2. useEffect sees no submissions in Redux
3. useEffect dispatches fetchSubmissions
4. Redux updates → component re-renders
5. useEffect runs again (because submissions array changed)
6. But submissions might still be empty (race condition)
7. useEffect dispatches again
8. Multiple requests → performance issues → potential loops
```

## Summary: Why It All Broke

The combination of all four issues created a perfect storm:

1. **Unstable selector** (Date.now()) → Selector returns "new" value every render
2. **useEffect depends on selector result** → useEffect runs on every render
3. **submissions.length dependency** → Additional trigger for useEffect
4. **No refs to break the cycle** → No mechanism to prevent duplicate dispatches

### The Fix Strategy

1. **Remove Date.now() from selectors** - Make selectors stable by only returning data, not checking TTL
2. **Move TTL check to fetch logic** - Check TTL before dispatching fetchWallet, not in selector
3. **Remove unstable dependencies from useEffect** - Use refs or check Redux state directly inside useEffect
4. **Bring back refs** - Use refs to track loading attempts and prevent duplicate dispatches

## Key Lesson

**Selectors must be pure and stable**. They should:
- Return the same reference for the same data
- Not call functions that return new values (like Date.now())
- Not perform side effects
- Only transform Redux state to the desired shape

TTL/cache expiration checks should happen **before** dispatching actions or **outside** the render cycle, never inside selectors.

