import { PrismaClient } from '@prisma/client';
import { notifyTaskAssignment } from '../src/tareas/notification.js';
import 'dotenv/config';

const prisma = new PrismaClient();

async function main() {
  console.log("Searching for a valid employee and task in database...");
  
  // Find a task
  const task = await prisma.tarea.findFirst({
    where: { eliminado: false },
    select: { id: true, nombre: true }
  });

  // Find an employee with a user and email
  const employee = await prisma.empleado.findFirst({
    where: {
      eliminado: false,
      usuario: {
        correo: { not: "" },
        eliminado: false
      }
    },
    include: {
      usuario: true
    }
  });

  if (!task) {
    console.log("No tasks found in the database. Cannot run notification test.");
    return;
  }

  if (!employee) {
    console.log("No employees with a valid user and email found in the database.");
    return;
  }

  console.log(`Found task: "${task.nombre}" (ID: ${task.id})`);
  console.log(`Found employee: "${employee.usuario.nombre}" <${employee.usuario.correo}> (ID: ${employee.id})`);

  console.log("Triggering notifyTaskAssignment...");
  await notifyTaskAssignment({
    tareaId: task.id,
    responsableId: employee.id,
    isSubtask: false
  });

  console.log("Notification test finished.");
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
