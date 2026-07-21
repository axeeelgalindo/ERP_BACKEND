const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("=== VERIFYING CLIENT RELATIONSHIP AND CRUD IN PROJECTS ===");

  // 1. Fetch a client to use for testing
  const client = await prisma.cliente.findFirst({
    where: { eliminado: false }
  });
  if (!client) {
    console.error("No clients found in the database. Please create a client first.");
    return;
  }
  console.log(`Using client: ID=${client.id}, Nombre=${client.nombre}`);

  // 2. Create a new test project with direct cliente_id
  console.log("Creating test project...");
  const tempProject = await prisma.proyecto.create({
    data: {
      nombre: "Temp Test Project For Client Link",
      empresa_id: client.empresa_id,
      cliente_id: client.id,
      presupuesto: 1500000,
    },
    include: {
      cliente: true
    }
  });
  console.log("Created project details:", {
    id: tempProject.id,
    nombre: tempProject.nombre,
    cliente_id: tempProject.cliente_id,
    clienteNombre: tempProject.cliente?.nombre
  });

  if (tempProject.cliente_id === client.id && tempProject.cliente?.nombre === client.nombre) {
    console.log("SUCCESS: Direct project creation with client_id verified!");
  } else {
    console.error("FAILED: Direct project creation with client_id failed verification.");
  }

  // 3. Update the project (set cliente_id to null)
  console.log("Updating test project to remove client...");
  const updatedProject = await prisma.proyecto.update({
    where: { id: tempProject.id },
    data: { cliente_id: null },
    include: { cliente: true }
  });
  console.log("Updated project details:", {
    id: updatedProject.id,
    cliente_id: updatedProject.cliente_id,
    cliente: updatedProject.cliente
  });

  if (updatedProject.cliente_id === null && !updatedProject.cliente) {
    console.log("SUCCESS: Direct project update (removing client) verified!");
  } else {
    console.error("FAILED: Direct project update (removing client) failed verification.");
  }

  // 4. Delete the test project
  console.log("Cleaning up test project...");
  await prisma.proyecto.delete({
    where: { id: tempProject.id }
  });
  console.log("Cleanup complete!");
}

main()
  .catch(err => console.error(err))
  .finally(() => prisma.$disconnect());
