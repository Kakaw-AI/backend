import { describe, expect, it } from 'vitest';
import { connectionStringError } from '../../src/database-sources/connection-string';

describe('connectionStringError', () => {
  it('accepts postgres URLs and refuses other schemes', () => {
    expect(
      connectionStringError('postgresql', 'postgresql://u:p@db.example.com/shop'),
    ).toBeNull();
    expect(
      connectionStringError('postgresql', 'postgres://u:p@db.example.com/shop'),
    ).toBeNull();
    expect(
      connectionStringError('postgresql', 'mongodb://h/shop'),
    ).toMatch(/postgresql:\/\//);
  });

  it('accepts standard, SRV and replica-set MongoDB strings with a database', () => {
    expect(
      connectionStringError('mongodb', 'mongodb+srv://u:p@cluster0.x.mongodb.net/shop?retryWrites=true'),
    ).toBeNull();
    expect(
      connectionStringError('mongodb', 'mongodb://u:p@h1:27017,h2:27017/shop?replicaSet=rs0'),
    ).toBeNull();
  });

  it('requires a MongoDB database name and scheme', () => {
    expect(
      connectionStringError('mongodb', 'mongodb+srv://u:p@cluster0.x.mongodb.net/?retryWrites=true'),
    ).toMatch(/name a database/);
    expect(
      connectionStringError('mongodb', 'mongodb://u:p@host:27017'),
    ).toMatch(/name a database/);
    expect(
      connectionStringError('mongodb', 'postgresql://h/shop'),
    ).toMatch(/mongodb:\/\//);
  });
});
