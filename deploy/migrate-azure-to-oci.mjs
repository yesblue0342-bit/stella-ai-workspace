// Azure SQL → OCI(stella-mssql) 메타DB 1회 이관 스크립트.
// 앱 컨테이너(stella-workspace)에서 실행 — mssql 모듈 사용.
//
// 실행(호스트에서):
//   cd /opt/stella-ai-workspace
//   AZ_SERVER=$(grep -E '^(DB_SERVER|AZURE_SQL_SERVER)=' .env.bak2 | head -1 | cut -d= -f2-)
//   AZ_USER=$(grep -E '^(DB_USER|AZURE_SQL_USER)='     .env.bak2 | head -1 | cut -d= -f2-)
//   AZ_PW=$(grep   -E '^(DB_PASSWORD|AZURE_SQL_PASSWORD)=' .env.bak2 | head -1 | cut -d= -f2-)
//   AZ_DB=$(grep   -E '^(DB_NAME|AZURE_SQL_DATABASE)='  .env.bak2 | head -1 | cut -d= -f2-)
//   sudo docker exec -e AZ_SERVER="$AZ_SERVER" -e AZ_USER="$AZ_USER" -e AZ_PW="$AZ_PW" -e AZ_DB="$AZ_DB" \
//        stella-workspace node /app/deploy/migrate-azure-to-oci.mjs
//
// OCI 접속정보(sa/DB_PASSWORD)는 컨테이너 환경변수에서 그대로 사용.
import sql from "mssql";

const azure = {
  user: process.env.AZ_USER,
  password: process.env.AZ_PW,
  server: String(process.env.AZ_SERVER || "").replace(/^tcp:/i, "").split(",")[0],
  database: process.env.AZ_DB || "master",
  port: 1433,
  options: { encrypt: true, trustServerCertificate: false, enableArithAbort: true },
  connectionTimeout: 30000, requestTimeout: 180000,
};
const oci = {
  user: process.env.DB_USER || "sa",
  password: process.env.DB_PASSWORD,
  server: "stella-mssql",
  database: "stella",
  port: 1433,
  options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
  connectionTimeout: 30000, requestTimeout: 180000,
};

// id(identity) 컬럼 제외하고 모든 컬럼을 그대로 복사. pk가 있으면 먼저 삭제 후 삽입(멱등).
async function copyTable(az, ociPool, table, pk) {
  let rows;
  try {
    rows = (await az.request().query(`SELECT * FROM dbo.${table}`)).recordset;
  } catch (e) {
    console.log(`  ⚠️ Azure.${table} 읽기 실패(테이블 없음?): ${e.message}`);
    return 0;
  }
  if (!rows.length) { console.log(`  · ${table}: Azure 0행`); return 0; }
  const cols = Object.keys(rows[0]).filter((c) => c.toLowerCase() !== "id");
  let n = 0;
  for (const row of rows) {
    try {
      if (pk && cols.includes(pk)) {
        const d = ociPool.request(); d.input("k", row[pk]);
        await d.query(`DELETE FROM dbo.${table} WHERE [${pk}]=@k`);
      }
      const req = ociPool.request();
      cols.forEach((c, i) => req.input("p" + i, row[c]));
      await req.query(
        `INSERT INTO dbo.${table} (${cols.map((c) => `[${c}]`).join(",")}) ` +
        `VALUES (${cols.map((c, i) => `@p${i}`).join(",")})`
      );
      n++;
    } catch (e) { console.log(`    ! ${table} 행 복사 실패: ${e.message}`); }
  }
  console.log(`  ✅ ${table}: ${n}/${rows.length}행 복사`);
  return n;
}

const azPool = await new sql.ConnectionPool(azure).connect();
console.log("Azure 연결 OK:", azure.server, "/ db=", azure.database);
const ociPool = await new sql.ConnectionPool(oci).connect();
console.log("OCI(stella-mssql/stella) 연결 OK");

let total = 0;
total += await copyTable(azPool, ociPool, "workspace_state", "owner_id");
total += await copyTable(azPool, ociPool, "chat_index", null);
total += await copyTable(azPool, ociPool, "member_chat_index", null);

console.log("\n🎉 이관 완료 — 총 " + total + "행 복사됨 (Azure→OCI). 이제 Azure 종료 가능.");
await azPool.close();
await ociPool.close();
