import { execute, queryOne } from './db';
import { hashPasswordSync } from '../utils/password';

const DEFAULT_USERS = [
  {
    email: 'admin@sistema.com',
    username: 'admin',
    password: 'Admin123',
    role: 'ADMIN'
  },
  {
    email: 'maestro@sistema.com',
    username: 'maestro',
    password: 'Maestro123',
    role: 'TEACHER'
  },
  {
    email: 'alumno@sistema.com',
    username: 'alumno',
    password: 'Alumno123',
    role: 'STUDENT'
  }
] as const;

export const seedDatabase = async (): Promise<void> => {
  const userCount = await queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM users');

  if (!userCount || userCount.total === 0) {
    for (const user of DEFAULT_USERS) {
      await execute(
        `INSERT INTO users (email, username, password, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, NOW(), NOW())`,
        [user.email, user.username, hashPasswordSync(user.password), user.role]
      );
    }
  }

  const careerCount = await queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM careers');
  if (!careerCount || careerCount.total === 0) {
    await execute(
      `INSERT INTO careers (name, semesters, created_at, updated_at)
       VALUES (?, ?, NOW(), NOW())`,
      ['Ingeniería en Sistemas', 9]
    );
    await execute(
      `INSERT INTO careers (name, semesters, created_at, updated_at)
       VALUES (?, ?, NOW(), NOW())`,
      ['Administración', 8]
    );
  }

  const subjectCount = await queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM subjects');
  if (!subjectCount || subjectCount.total === 0) {
    const career = await queryOne<{ id: number }>('SELECT id FROM careers WHERE name = ?', ['Ingeniería en Sistemas']);
    if (career) {
      await execute(
        `INSERT INTO subjects (name, credits, semester, career_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, NOW(), NOW())`,
        ['Programación I', 8, 1, career.id]
      );
      await execute(
        `INSERT INTO subjects (name, credits, semester, career_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, NOW(), NOW())`,
        ['Bases de Datos', 7, 3, career.id]
      );
    }
  }

  const teacherCount = await queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM teachers');
  if (!teacherCount || teacherCount.total === 0) {
    const teacherUser = await queryOne<{ id: number }>('SELECT id FROM users WHERE username = ?', ['maestro']);
    const career = await queryOne<{ id: number }>('SELECT id FROM careers WHERE name = ?', ['Ingeniería en Sistemas']);
    const subject = await queryOne<{ id: number }>('SELECT id FROM subjects WHERE name = ?', ['Programación I']);

    if (teacherUser && career && subject) {
      const result = await execute(
        `INSERT INTO teachers (user_id, name, degree, created_at, updated_at)
         VALUES (?, ?, ?, NOW(), NOW())`,
        [teacherUser.id, 'Juan Pérez', 'LICENCIATURA']
      );
      const teacherId = result.insertId;

      await execute(
        `INSERT INTO teacher_careers (teacher_id, career_id)
         VALUES (?, ?)`,
        [teacherId, career.id]
      );

      await execute(
        `INSERT INTO teacher_subjects (teacher_id, subject_id)
         VALUES (?, ?)`,
        [teacherId, subject.id]
      );
    }
  }

  const studentCount = await queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM students');
  if (!studentCount || studentCount.total === 0) {
    const studentUser = await queryOne<{ id: number }>('SELECT id FROM users WHERE username = ?', ['alumno']);
    const career = await queryOne<{ id: number }>('SELECT id FROM careers WHERE name = ?', ['Ingeniería en Sistemas']);
    if (studentUser && career) {
      await execute(
        `INSERT INTO students (user_id, name, status, date_of_birth, career_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
        [studentUser.id, 'Ana López', 'ACTIVE', '2003-05-15', career.id]
      );
    }
  }

  const scheduleCount = await queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM schedules');
  if (!scheduleCount || scheduleCount.total === 0) {
    await execute(
      `INSERT INTO schedules (shift, time, created_at, updated_at)
       VALUES (?, ?, NOW(), NOW())`,
      ['MATUTINO', '08:00:00']
    );
    await execute(
      `INSERT INTO schedules (shift, time, created_at, updated_at)
       VALUES (?, ?, NOW(), NOW())`,
      ['VESPERTINO', '16:00:00']
    );
  }

  const classroomCount = await queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM classrooms');
  if (!classroomCount || classroomCount.total === 0) {
    await execute(
      `INSERT INTO classrooms (name, building, created_at, updated_at)
       VALUES (?, ?, NOW(), NOW())`,
      ['Aula 101', 'Edificio A']
    );
    await execute(
      `INSERT INTO classrooms (name, building, created_at, updated_at)
       VALUES (?, ?, NOW(), NOW())`,
      ['Laboratorio 1', 'Edificio B']
    );
  }
};
