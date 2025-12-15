import express, { Request, Response } from 'express';
import flutterwaveService from '../services/flutterwaveService';

const router = express.Router();

// Get banks
router.get('/banks', async (req: Request, res: Response) => {
  try {
    const country = (req.query.country as string) || 'NG';
    const banks = await flutterwaveService.getBanks(country);
    
    res.status(200).json({
      success: true,
      banks,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Verify account
router.post('/verify-account', async (req: Request, res: Response) => {
  try {
    const { accountNumber, bankCode } = req.body;

    if (!accountNumber || !bankCode) {
      return res.status(400).json({
        success: false,
        message: 'Account number and bank code are required',
      });
    }

    const result = await flutterwaveService.verifyAccount(accountNumber, bankCode);
    
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

// Create subaccount
router.post('/create-subaccount', async (req: Request, res: Response) => {
  try {
    const { accountNumber, bankCode, businessName, email, phoneNumber, splitPercentage } = req.body;

    if (!accountNumber || !bankCode || !businessName || !email) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    const result = await flutterwaveService.createSubaccount({
      accountNumber,
      bankCode,
      businessName,
      email,
      phoneNumber,
      splitPercentage,
    });
    
    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

export default router;