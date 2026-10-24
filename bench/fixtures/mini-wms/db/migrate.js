const pool = require("./pool");

const SQL = `
create table if not exists orders (
  id serial primary key,
  code text not null unique,
  status text not null default 'WAITING',
  created_at timestamptz not null default now()
);
create table if not exists stock_movements (
  id serial primary key,
  order_id int not null references orders(id),
  from_area text not null,
  to_area text not null,
  created_at timestamptz not null default now()
);
`;

pool.query(SQL)
  .then(() => { console.log("migrated"); return pool.end(); })
  .catch(e => { console.error(e.message); process.exit(1); });
