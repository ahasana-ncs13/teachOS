import { Router } from 'express'
import { requirePlatformActive, requireRole, verifyToken } from '../middleware/auth.js'
import * as userService from '../services/user.service.js'
import { sanitizeInput, validatePagination, validateSchema } from '../utils/validation.js'

export const userRouter = Router()

userRouter.get('/users/me', verifyToken, (req, res) => {
  const { uid, email, role, fullName, status } = req.user
  res.json({ user: { uid, email, role, fullName, status } })
})

// User management is global and limited to the TeachOS admin.
userRouter.use('/admin/users', verifyToken, requireRole('admin'), requirePlatformActive)

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
