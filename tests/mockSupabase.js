/**
 * Mock Supabase client for testing
 * Use this in CI to avoid real database calls
 * Set USE_MOCK_SUPABASE=true to enable mocking
 */

class MockSupabaseClient {
  constructor() {
    this.data = {
      users: [],
      words: [],
      user_words: [],
      user_stats: [],
      active_sessions: []
    };
  }

  from(table) {
    return new MockQueryBuilder(this, table);
  }
}

class MockQueryBuilder {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.filters = [];
    this.orderBy = null;
    this.limitValue = null;
    this.selectFields = '*';
    this.countMode = false;
  }

  select(fields, options = {}) {
    if (options.count === 'exact' && options.head === true) {
      this.countMode = true;
    } else {
      this.selectFields = fields;
    }
    return this;
  }

  eq(column, value) {
    this.filters.push({ type: 'eq', column, value });
    return this;
  }

  neq(column, value) {
    this.filters.push({ type: 'neq', column, value });
    return this;
  }

  in(column, values) {
    this.filters.push({ type: 'in', column, value: values });
    return this;
  }

  gt(column, value) {
    this.filters.push({ type: 'gt', column, value });
    return this;
  }

  gte(column, value) {
    this.filters.push({ type: 'gte', column, value });
    return this;
  }

  lt(column, value) {
    this.filters.push({ type: 'lt', column, value });
    return this;
  }

  lte(column, value) {
    this.filters.push({ type: 'lte', column, value });
    return this;
  }

  ilike(column, pattern) {
    this.filters.push({ type: 'ilike', column, pattern });
    return this;
  }

  not(column, operator, value) {
    this.filters.push({ type: 'not', column, operator, value });
    return this;
  }

  order(column, options = {}) {
    this.orderBy = { column, ascending: options.ascending !== false };
    return this;
  }

  limit(count) {
    this.limitValue = count;
    return this;
  }

  maybeSingle() {
    this.singleMode = true;
    return this;
  }

  single() {
    this.singleMode = true;
    return this;
  }

  async execute() {
    // If we have inserted data (from insert().select()), use that
    let data = this.insertedData ? [...this.insertedData] : [...(this.client.data[this.table] || [])];

    // Apply filters
    for (const filter of this.filters) {
      data = data.filter(row => {
        const value = row[filter.column];
        switch (filter.type) {
          case 'eq':
            return String(value) === String(filter.value);
          case 'neq':
            return String(value) !== String(filter.value);
          case 'gt':
            return new Date(value) > new Date(filter.value);
          case 'gte':
            return new Date(value) >= new Date(filter.value);
          case 'lt':
            return new Date(value) < new Date(filter.value);
          case 'lte':
            return new Date(value) <= new Date(filter.value);
          case 'ilike':
            return String(value).toLowerCase().includes(String(filter.pattern).toLowerCase());
          case 'not':
            // Simple NOT IN implementation
            if (filter.operator === 'in') {
              const ids = filter.value.replace(/[()]/g, '').split(',').map(id => parseInt(id.trim()));
              return !ids.includes(value);
            }
            return true;
          case 'in':
            // Support IN operator for arrays
            const inValues = Array.isArray(filter.value) ? filter.value : filter.value.replace(/[()]/g, '').split(',').map(v => v.trim());
            return inValues.includes(String(value)) || inValues.includes(parseInt(value));
          default:
            return true;
        }
      });
    }

    // Apply ordering
    if (this.orderBy) {
      data.sort((a, b) => {
        const aVal = a[this.orderBy.column];
        const bVal = b[this.orderBy.column];
        if (this.orderBy.ascending) {
          return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
        } else {
          return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
        }
      });
    }

    // Apply limit
    if (this.limitValue) {
      data = data.slice(0, this.limitValue);
    }

    // Handle count mode
    if (this.countMode) {
      return { count: data.length, error: null };
    }

    // Handle single mode
    if (this.singleMode) {
      if (data.length === 0) {
        return { data: null, error: { message: 'No rows found' } };
      }
      return { data: data[0], error: null };
    }

    return { data, error: null };
  }

  // Make query builder thenable (works with await)
  then(onResolve, onReject) {
    if (this.isDelete) {
      return this.executeDelete().then(onResolve, onReject);
    }
    return this.execute().then(onResolve, onReject);
  }

  catch(onReject) {
    if (this.isDelete) {
      return this.executeDelete().catch(onReject);
    }
    return this.execute().catch(onReject);
  }

  async insert(values) {
    const table = this.client.data[this.table];
    const records = Array.isArray(values) ? values : [values];
    const inserted = records.map(record => ({
      ...record,
      id: record.id || Math.floor(Math.random() * 1000000),
      created_at: record.created_at || new Date().toISOString()
    }));
    table.push(...inserted);
    
    // Return a thenable object that supports .select().single() chaining
    const result = {
      data: inserted.length === 1 ? inserted[0] : inserted,
      error: null
    };
    
    // Add select() method that returns a query builder
    result.select = (fields) => {
      const builder = new MockQueryBuilder(this.client, this.table);
      builder.insertedData = inserted;
      builder.selectFields = fields || '*';
      return builder;
    };
    
    return result;
  }

  async update(values) {
    const table = this.client.data[this.table];
    let updated = [];
    
    for (const filter of this.filters) {
      if (filter.type === 'eq') {
        const index = table.findIndex(row => String(row[filter.column]) === String(filter.value));
        if (index !== -1) {
          table[index] = { ...table[index], ...values };
          updated.push(table[index]);
        }
      }
    }

    return {
      data: updated.length === 1 ? updated[0] : updated,
      error: null,
      select: () => this,
      single: () => ({ data: updated[0] || null, error: null })
    };
  }

  delete() {
    // Mark as delete operation and return this for chaining
    this.isDelete = true;
    return this;
  }
  
  async executeDelete() {
    const table = this.client.data[this.table];
    let deleted = [];
    
    // Apply all filters
    for (let i = table.length - 1; i >= 0; i--) {
      const row = table[i];
      let matches = true;
      
      for (const filter of this.filters) {
        const value = row[filter.column];
        switch (filter.type) {
          case 'eq':
            if (String(value) !== String(filter.value)) {
              matches = false;
            }
            break;
          case 'neq':
            if (String(value) === String(filter.value)) {
              matches = false;
            }
            break;
          case 'gt':
            if (new Date(value) <= new Date(filter.value)) {
              matches = false;
            }
            break;
          case 'gte':
            if (new Date(value) < new Date(filter.value)) {
              matches = false;
            }
            break;
          case 'lt':
            if (new Date(value) >= new Date(filter.value)) {
              matches = false;
            }
            break;
          case 'lte':
            if (new Date(value) > new Date(filter.value)) {
              matches = false;
            }
            break;
          default:
            break;
        }
        if (!matches) break;
      }
      
      if (matches) {
        deleted.push(table.splice(i, 1)[0]);
      }
    }

    return { data: deleted.length > 0 ? deleted : null, error: null };
  }
}

// Make query builder methods return promises
['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'ilike', 'not', 'in', 'order', 'limit', 'maybeSingle', 'single', 'delete'].forEach(method => {
  const original = MockQueryBuilder.prototype[method];
  MockQueryBuilder.prototype[method] = function(...args) {
    const result = original.apply(this, args);
    if (result === this) {
      // Chainable method - return this
      return this;
    }
    // If it returns a promise, return it
    if (result && typeof result.then === 'function') {
      return result;
    }
    // Otherwise, return this for chaining
    return this;
  };
});

// Add then() to make query builder thenable
MockQueryBuilder.prototype.then = function(resolve, reject) {
  return this.execute().then(resolve, reject);
};

// Add catch() for error handling
MockQueryBuilder.prototype.catch = function(reject) {
  return this.execute().catch(reject);
};

module.exports = MockSupabaseClient;

