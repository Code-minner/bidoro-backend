import { Request, Response, NextFunction } from 'express';
import validator from 'validator';

export const validateRegistration = (req: Request, res: Response, next: NextFunction): void => {
  const { name, email, password, role } = req.body;

  // Required fields
  if (!name || !email || !password) {
    res.status(400).json({
      success: false,
      message: 'Name, email, and password are required'
    });
    return;
  }

  // Email validation
  if (!validator.isEmail(email)) {
    res.status(400).json({
      success: false,
      message: 'Please provide a valid email address'
    });
    return;
  }

  // Password strength
  if (password.length < 6) {
    res.status(400).json({
      success: false,
      message: 'Password must be at least 6 characters long'
    });
    return;
  }

  // Role validation
  if (role && !['buyer', 'seller'].includes(role)) {
    res.status(400).json({
      success: false,
      message: 'Role must be either buyer or seller'
    });
    return;
  }

  // Name validation
  if (name.length < 2) {
    res.status(400).json({
      success: false,
      message: 'Name must be at least 2 characters long'
    });
    return;
  }

  next();
};

export const validateLogin = (req: Request, res: Response, next: NextFunction): void => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({
      success: false,
      message: 'Email and password are required'
    });
    return;
  }

  if (!validator.isEmail(email)) {
    res.status(400).json({
      success: false,
      message: 'Please provide a valid email address'
    });
    return;
  }

  next();
};