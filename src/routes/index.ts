import { Router } from 'express';
import authRoutes from './authRoutes';
import userRoutes from './userRoutes';
import studentRoutes from './studentRoutes';
import careerRoutes from './careerRoutes';
import subjectRoutes from './subjectRoutes';
import teacherRoutes from './teacherRoutes';
import scheduleRoutes from './scheduleRoutes';
import classroomRoutes from './classroomRoutes';
import groupRoutes from './groupRoutes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/students', studentRoutes);
router.use('/careers', careerRoutes);
router.use('/subjects', subjectRoutes);
router.use('/teachers', teacherRoutes);
router.use('/schedules', scheduleRoutes);
router.use('/classrooms', classroomRoutes);
router.use('/groups', groupRoutes);

export default router;
