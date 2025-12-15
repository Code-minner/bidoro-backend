import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

export const getStates = async (req: Request, res: Response): Promise<void> => {
  try {
    const { data: states, error } = await supabase
      .from('locations')
      .select('state')
      .eq('is_active', true)
      .order('state');

    if (error) {
      console.error('Get states error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch states'
      });
      return;
    }

    // Remove duplicates
    const uniqueStates = [...new Set(states.map(item => item.state))];

    res.status(200).json({
      success: true,
      data: { states: uniqueStates }
    });

  } catch (error) {
    console.error('Get states error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getCitiesByState = async (req: Request, res: Response): Promise<void> => {
  try {
    const { state } = req.params;

    const { data: cities, error } = await supabase
      .from('locations')
      .select('city, area')
      .eq('state', state)
      .eq('is_active', true)
      .order('city');

    if (error) {
      console.error('Get cities error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch cities'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: { cities }
    });

  } catch (error) {
    console.error('Get cities error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getAllLocations = async (req: Request, res: Response): Promise<void> => {
  try {
    const { data: locations, error } = await supabase
      .from('locations')
      .select('*')
      .eq('is_active', true)
      .order('state')
      .order('city');

    if (error) {
      console.error('Get locations error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch locations'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: { locations }
    });

  } catch (error) {
    console.error('Get locations error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};