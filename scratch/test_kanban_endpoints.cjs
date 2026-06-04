const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("1. Finding a test employee to assign as responsible...");
  const empleado = await prisma.empleado.findFirst({
    where: {
      eliminado: false,
      usuario: {
        eliminado: false
      }
    },
    include: {
      usuario: true
    }
  });

  if (!empleado) {
    throw new Error("No active employee found in database.");
  }
  const empresaId = empleado.usuario.empresa_id;
  console.log(`Found employee ID: ${empleado.id} under Company ID: ${empresaId}`);

  console.log("2. Finding or creating a test epic in the company...");
  let epica = await prisma.epica.findFirst({
    where: {
      empresa_id: empresaId,
      eliminado: false
    }
  });

  if (!epica) {
    console.log("No existing epic found. Creating a test epic first...");
    epica = await prisma.epica.create({
      data: {
        empresa_id: empresaId,
        destino: "TALLER",
        centro_costo: "PMC",
        nombre: "Épica de Prueba Taller",
        estado: "pendiente"
      }
    });
  }
  console.log(`Using epic ID: ${epica.id}`);

  console.log("3. Creating a task for TALLER destination...");
  const fip = new Date();
  const ffp = new Date();
  ffp.setDate(fip.getDate() + 1);

  const taskData = {
    empresa_id: empresaId,
    destino: "TALLER",
    centro_costo: "PUQ",
    epica_id: epica.id,
    nombre: "Tarea Automatizada de Test Taller",
    descripcion: "Creada por script de verificación",
    responsable_id: empleado.id,
    prioridad: 2,
    es_planificado: true,
    fecha_inicio_plan: fip,
    fecha_fin_plan: ffp,
    dias_plan: 1
  };

  const createdTask = await prisma.tarea.create({
    data: taskData
  });

  console.log(`Successfully created task ID: ${createdTask.id}`);
  console.log(`Destino: ${createdTask.destino}, Centro Costo: ${createdTask.centro_costo}`);

  console.log("4. Fetching Kanban data for the company...");
  const baseWhereTarea = {
    empresa_id: empresaId,
    eliminado: false,
    destino: "TALLER",
    centro_costo: "PUQ"
  };

  const tasksFetched = await prisma.tarea.findMany({
    where: baseWhereTarea,
    include: {
      proyecto: { select: { nombre: true } },
      epica: { select: { nombre: true } },
      responsable: { include: { usuario: { select: { nombre: true } } } },
      evidencias: true,
    }
  });

  console.log(`Fetched ${tasksFetched.length} tasks matching destino: TALLER and centro_costo: PUQ`);
  const testFetchedTask = tasksFetched.find(t => t.id === createdTask.id);

  if (testFetchedTask) {
    console.log("✅ Task successfully retrieved in filtered Kanban query!");
    const parent_name = testFetchedTask.epica?.nombre || testFetchedTask.proyecto?.nombre || (testFetchedTask.destino === "PROYECTO" ? "Proyecto" : testFetchedTask.destino === "TALLER" ? "Taller" : "Administración");
    console.log(`Parent Name Resolved: ${parent_name}`);
  } else {
    console.log("❌ Task not found in fetched results!");
  }

  console.log("5. Cleaning up test data...");
  await prisma.tarea.delete({
    where: { id: createdTask.id }
  });
  console.log("Cleanup complete!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
