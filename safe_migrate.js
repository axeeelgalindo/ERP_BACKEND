import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  try {
    console.log("Starting safe migration on VPS...");

    // 1. Add column empresa_id as nullable if it does not exist
    console.log("Ensuring 'empresa_id' column exists in database...");
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "Venta" ADD COLUMN IF NOT EXISTS "empresa_id" text;'
    );
    console.log("Column 'empresa_id' verified/created.");

    // 2. Fetch all companies
    const companies = await prisma.empresa.findMany({ select: { id: true } });
    if (companies.length === 0) {
      console.log("No companies found in database!");
      return;
    }
    const defaultCompanyId = companies[0].id;
    console.log("Default company ID:", defaultCompanyId);

    // 3. Fetch all Ventas with relations using the old client
    console.log("Fetching all existing ventas to resolve company and sequence...");
    const ventas = await prisma.venta.findMany({
      include: {
        ordenVenta: true,
        detalles: {
          include: {
            hhEmpleado: true,
            compras: { include: { compra: true } }
          }
        }
      },
      orderBy: { createdAt: "asc" }
    });

    console.log(`Found ${ventas.length} ventas to process.`);

    const companyVentas = {};
    for (const c of companies) {
      companyVentas[c.id] = [];
    }

    for (const v of ventas) {
      let resolvedEmpresaId = null;

      if (v.ordenVenta?.empresa_id) {
        resolvedEmpresaId = v.ordenVenta.empresa_id;
      } else {
        for (const d of v.detalles) {
          if (d.hhEmpleado?.empresa_id) {
            resolvedEmpresaId = d.hhEmpleado.empresa_id;
            break;
          }
        }
        if (!resolvedEmpresaId) {
          for (const d of v.detalles) {
            if (d.compras?.compra?.empresa_id) {
              resolvedEmpresaId = d.compras.compra.empresa_id;
              break;
            }
          }
        }
      }

      if (!resolvedEmpresaId) {
        resolvedEmpresaId = defaultCompanyId;
      }

      if (!companyVentas[resolvedEmpresaId]) {
        companyVentas[resolvedEmpresaId] = [];
      }
      companyVentas[resolvedEmpresaId].push(v);
    }

    // 4. Update each Venta with correct company and sequence
    console.log("Updating Venta records in database...");
    for (const [empresaId, list] of Object.entries(companyVentas)) {
      console.log(`Company ${empresaId} will receive ${list.length} sequential ventas.`);
      for (let i = 0; i < list.length; i++) {
        const v = list[i];
        const newNumero = i + 1;
        
        // Use raw SQL to update the fields safely since client schema may differ
        await prisma.$executeRawUnsafe(
          'UPDATE "Venta" SET "empresa_id" = $1, "numero" = $2 WHERE "id" = $3',
          empresaId,
          newNumero,
          v.id
        );
        
        console.log(`Updated Venta ${v.id} -> empresaId=${empresaId}, numero=${newNumero}`);
      }
    }

    console.log("Safe migration completed successfully! You can now run 'npx prisma db push'.");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
