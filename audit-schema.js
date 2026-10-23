'use strict';
// Atualiza somente a tabela de auditoria; mantém registros e colunas antigas.
async function ensureAuditSchema(pool) {
  await pool.query(`ALTER TABLE app_audit
    ADD COLUMN IF NOT EXISTS user_id TEXT,
    ADD COLUMN IF NOT EXISTS username TEXT,
    ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
  // Versões antigas exigiam campos com outros nomes. Eles continuam no banco,
  // mas deixam de ser obrigatórios para as gravações que usam o esquema atual.
  const legacy=await pool.query(`SELECT c.column_name FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name='app_audit'
      AND c.is_nullable='NO' AND c.column_default IS NULL
      AND c.column_name NOT IN ('id','user_id','username','action','details','created_at')
      AND NOT EXISTS (SELECT 1 FROM information_schema.key_column_usage k
        JOIN information_schema.table_constraints t ON t.constraint_name=k.constraint_name
          AND t.table_schema=k.table_schema AND t.table_name=k.table_name
        WHERE k.table_schema=c.table_schema AND k.table_name=c.table_name
          AND k.column_name=c.column_name AND t.constraint_type='PRIMARY KEY')`);
  for(const {column_name} of legacy.rows){
    const name='"'+String(column_name).replace(/"/g,'""')+'"';
    await pool.query(`ALTER TABLE app_audit ALTER COLUMN ${name} DROP NOT NULL`);
  }
}
module.exports={ensureAuditSchema};
