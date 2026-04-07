# Testing Guide

## Overview

The test suite supports both **real Supabase** (for local development) and **mock Supabase** (for CI pipelines) to avoid database overhead and costs.

## Running Tests

### Local Development (Real Supabase)

By default, tests use your real Supabase database:

```bash
npm test
```

**Requirements:**

- Set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in your environment
- Use a development/test database (not production)

### CI Pipeline (Mock Supabase)

For GitHub Actions or other CI environments, tests automatically use mocks:

```bash
# Automatically uses mocks when CI=true
CI=true npm test

# Or explicitly enable mocks
USE_MOCK_SUPABASE=true npm test
```

**Benefits:**

- No database calls = faster tests
- No rate limits or costs
- No network dependencies
- Deterministic results

## Test Structure

### Mock Supabase Client

The `tests/mockSupabase.js` file provides a lightweight in-memory database that mimics Supabase's query builder pattern:

- Supports: `select()`, `insert()`, `update()`, `delete()`
- Filters: `eq()`, `gt()`, `gte()`, `lt()`, `lte()`, `ilike()`, `not()`
- Operations: `order()`, `limit()`, `single()`, `maybeSingle()`
- Count mode: `select('id', { count: 'exact', head: true })`

### Test Files

- `tests/functional.test.js` - Core functionality tests
- `tests/setup.js` - Test configuration and mock injection
- `tests/mockSupabase.js` - Mock database implementation

## Writing Tests

### Using Real Supabase

```javascript
const supabase = require("../db");

test("creates user", async () => {
  const { data } = await supabase
    .from("users")
    .insert({ chat_id: "123" })
    .select()
    .single();

  expect(data).toBeDefined();
});
```

### Using Mock Supabase

The same code works with mocks! The setup file automatically injects the mock when `CI=true`:

```javascript
// Works with both real and mock Supabase
const supabase = require("../db");

test("creates user", async () => {
  // Mock automatically initialized in CI
  const { data } = await supabase
    .from("users")
    .insert({ chat_id: "123" })
    .select()
    .single();

  expect(data).toBeDefined();
});
```

## CI Configuration

### GitHub Actions Example

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: "18"
      - run: npm install
      - run: npm test
        env:
          CI: true # Automatically uses mock Supabase
```

## Limitations

The mock Supabase has some limitations:

1. **No joins**: Complex queries with `:word_id(word)` syntax may not work
2. **Simple filtering**: Advanced filters may need implementation
3. **No transactions**: Each operation is independent
4. **In-memory only**: Data is lost between test runs

For complex queries, consider:

- Using real Supabase in local development
- Simplifying test queries to work with mocks
- Adding specific mock implementations for complex cases

## Best Practices

1. **Clean up test data**: Always delete test records in `afterAll` hooks
2. **Use unique IDs**: Avoid conflicts with existing data
3. **Test isolation**: Each test should be independent
4. **Mock for CI**: Always use mocks in CI to avoid costs and rate limits

## Troubleshooting

### Tests fail with "Cannot read property 'from' of undefined"

The mock isn't being injected. Check:

- `tests/setup.js` exists and is configured in `jest.config.js`
- `CI=true` or `USE_MOCK_SUPABASE=true` is set

### Tests work locally but fail in CI

The mock may not support a specific query pattern. Check:

- Query complexity (joins, complex filters)
- Add specific mock support if needed
- Or simplify the test query

### Mock doesn't match real Supabase behavior

Add specific implementations to `tests/mockSupabase.js` for the missing patterns.
