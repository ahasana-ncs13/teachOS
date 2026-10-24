import { Router } from 'express'
import { requirePlatformActive, requireRole, verifyToken } from '../middleware/auth.js'
import * as userService from '../services/user.service.js'
import { sanitizeInput, validatePagination, validateSchema } from '../utils/validation.js'

export const userRouter = Router()

// All user management routes require token + active platform + admin or superAdmin role
userRouter.use('/admin/users', verifyToken, requireRole('admin', 'superAdmin'), requirePlatformActive)

userRouter.post('/admin/users', async (req, res, next) => {
  try {
    const body = sanitizeInput(req.body, ['email', 'fullName', 'role', 'platformId'])
    validateSchema(body, {
      email: { required: true, type: 'string', min: 5, max: 100 },
      fullName: { required: true, type: 'string', min: 2, max: 100 },
      role: { required: true, type: 'string', enum: ['admin', 'teacher', 'student'] },
      platformId: { required: false, type: 'string' },
    })

    const user = await userService.createTenantUser(req, body)
    res.status(201).json({ user })
  } catch (error) {
    next(error)
  }
})

userRouter.get('/admin/users', async (req, res, next) => {
  try {
    const pagination = validatePagination(req.query)
    const { role, search } = req.query
    const result = await userService.listTenantUsers(req, {
      ...pagination,
      role,
      search,
    })
    res.json(result)
  } catch (error) {
    next(error)
  }
})

userRouter.delete('/admin/users/:id', async (req, res, next) => {
  try {
    const result = await userService.softDeleteTenantUser(req, req.params.id)
    res.json(result)
  } catch (error) {
    next(error)
  }
})
