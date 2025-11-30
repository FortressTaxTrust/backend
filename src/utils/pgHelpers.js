// pg-helper.js
import db, { pgp } from "../adapter/pgsql.js";

const PgHelper = {
  /**
   * Dynamic INSERT
   * table: string
   * data: object
   */
  insert: async (table, data) => {
    const query = pgp.helpers.insert(data, null, table) + " RETURNING *";
    return db.one(query);
  },

  /**
   * Dynamic MULTI INSERT (array of objects)
   */
  insertMany: async (table, rows, tx = null) => {
    const connection = tx || db; // Use transaction if provided, otherwise default db connection
    const cs = new pgp.helpers.ColumnSet(Object.keys(rows[0]), { table });
    const query = pgp.helpers.insert(rows, cs) + " RETURNING *";
    return connection.many(query);
  },

  /**
   * Dynamic UPDATE
   * table: string
   * data: object (fields to update)
   * condition: object (WHERE)
   */
  update: async (table, data, condition) => {
    const cs = new pgp.helpers.ColumnSet(Object.keys(data), { table });
    const conditionStr = pgp.as.format(
      " WHERE ${condition:raw}",
      { condition: Object.entries(condition).map(([k, v]) => `${k} = ${pgp.as.value(v)}`).join(" AND ") }
    );

    const query = pgp.helpers.update(data, cs) + conditionStr + " RETURNING *";
    return db.one(query);
  },

  /**
   * Dynamic SELECT
   * table: string
   * filters: object
   */
  select: async (table, filters = {}) => {
    const keys = Object.keys(filters);
    let query = `SELECT * FROM ${table}`;
    let values = [];
    if (keys.length) {
      const conditions = keys.map((k, i) => {
        values.push(filters[k]);
        return `${k} = $${i + 1}`; // parameterized query
      });
      query += ' WHERE ' + conditions.join(' AND ');
    }
    return db.any(query, values);
  },

  /**
   * Raw SQL
   */
  raw: async (query, params) => db.any(query, params),
};

export default PgHelper;
