// components/table.tsx
import prisma from "../lib/prisma";

export default async function Table() {
  const startTime = Date.now();

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
  });

  const duration = Date.now() - startTime;

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Users</h2>
        <span style={{ opacity: 0.7, fontSize: 12 }}>
          query: {duration}ms · rows: {users.length}
        </span>
      </div>

      {users.length === 0 ? (
        <p style={{ marginTop: 12, opacity: 0.8 }}>
          Keine Users vorhanden (Seed legt aktuell nur Packages + System Templates an).
        </p>
      ) : (
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #ddd" }}>
                  E-Mail
                </th>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Name
                </th>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Role
                </th>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{u.email}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{u.name ?? ""}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{u.role}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                    {u.createdAt.toISOString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
