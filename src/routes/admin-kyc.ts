// src/routes/admin-kyc.ts
// FIXED VERSION v2: 
// 1. Removed kyc_verified_at reference (column doesn't exist)
// 2. Added location mapping from KYC application to user
// 3. Added error handling for user update

import express from 'express';
import { Request, Response } from 'express';
import { supabaseAdmin as supabase } from "../config/database";
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth';
import { emailService } from '../services/emailService';

const router = express.Router();

// TODO: Uncomment these when admin login is implemented
// router.use(authenticateToken);
// router.use(requireAdmin);

// TEMPORARY: Mock admin user for development
router.use((req: AuthRequest, res, next) => {
  req.user = {
    id: 'dev-admin-id',
    email: 'admin@bidoro.com',
    name: 'Dev Admin',
    role: 'admin',
    account_status: 'active',
    kyc_status: 'verified',
    trust_score: 100
  };
  next();
});

// Get all KYC applications (with filters)
router.get('/applications', async (req: AuthRequest, res: Response) => {
  try {
    const { 
      status = 'submitted', 
      page = 1, 
      limit = 20,
      search 
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    // Build query - FIXED: Use explicit foreign key relationship
    let query = supabase
      .from('kyc_applications')
      .select(`
        *,
        users:user_id(
          user_id,
          name,
          email,
          phone_number,
          role,
          created_at
        )
      `, { count: 'exact' })
      .order('submitted_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    // Add filters
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (search) {
      query = query.ilike('store_name', `%${search}%`);
    }

    const { data: applications, error, count } = await query;

    if (error) {
      console.error('Admin KYC applications error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch applications'
      });
    }

    // Get summary stats
    const { data: stats } = await supabase
      .from('kyc_applications')
      .select('status')
      .not('status', 'eq', 'draft');

    const summary = {
      total: stats?.length || 0,
      submitted: stats?.filter(s => s.status === 'submitted').length || 0,
      under_review: stats?.filter(s => s.status === 'under_review').length || 0,
      approved: stats?.filter(s => s.status === 'approved').length || 0,
      rejected: stats?.filter(s => s.status === 'rejected').length || 0
    };

    res.json({
      success: true,
      data: {
        applications,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: count || 0,
          pages: Math.ceil((count || 0) / Number(limit))
        },
        summary
      }
    });

  } catch (error) {
    console.error('Admin applications error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get specific KYC application details
router.get('/applications/:applicationId', async (req: AuthRequest, res: Response) => {
  try {
    const { applicationId } = req.params;

    // Get application with user details - FIXED: Use explicit foreign key
    const { data: application, error } = await supabase
      .from('kyc_applications')
      .select(`
        *,
        users:user_id(
          user_id,
          name,
          email,
          phone_number,
          location_state,
          location_city,
          role,
          created_at
        )
      `)
      .eq('application_id', applicationId)
      .single();

    if (error || !application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    // Get documents
    const { data: documents } = await supabase
      .from('kyc_documents')
      .select('*')
      .eq('application_id', applicationId);

    // Get status history - FIXED: Use explicit foreign key
    const { data: history } = await supabase
      .from('kyc_status_history')
      .select(`
        *,
        changed_by_user:changed_by(name, email)
      `)
      .eq('application_id', applicationId)
      .order('created_at', { ascending: false });

    res.json({
      success: true,
      data: {
        application,
        documents: documents || [],
        history: history || []
      }
    });

  } catch (error) {
    console.error('Admin application details error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update application status (approve/reject)
router.put('/applications/:applicationId/status', async (req: AuthRequest, res: Response) => {
  try {
    const { applicationId } = req.params;
    const { status, notes, reason } = req.body;
    const adminId = req.user!.id;
    
    // Check if adminId is a valid UUID (not mock admin)
    const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(adminId);
    const reviewedBy = isValidUUID ? adminId : null;

    const validStatuses = ['under_review', 'approved', 'rejected', 'resubmission_required'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    // Get current application - FIXED: Use explicit foreign key
    const { data: currentApp, error: fetchError } = await supabase
      .from('kyc_applications')
      .select(`
        *,
        users:user_id(name, email)
      `)
      .eq('application_id', applicationId)
      .single();

    if (fetchError || !currentApp) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    const oldStatus = currentApp.status;

    // If approving, create seller profile and bank account
    if (status === 'approved') {
      console.log(`\n=== APPROVING KYC APPLICATION ${applicationId} ===`);
      
      // 1. Create/Update seller profile
      const { data: existingProfile } = await supabase
        .from('seller_profiles')
        .select('profile_id')
        .eq('user_id', currentApp.user_id)
        .single();

      let profileId;

      if (existingProfile) {
        // Update existing profile
        const { data: updatedProfile, error: profileError } = await supabase
          .from('seller_profiles')
          .update({
            business_name: currentApp.store_name,
            business_registration_number: currentApp.business_id,
            store_address: currentApp.store_address,
            store_category: currentApp.store_category,
            logo_url: currentApp.store_logo_url,
            business_cert_url: currentApp.business_cert_url,
            pickup_options: currentApp.pickup_options,
            operating_hours: currentApp.active_hours,
            is_verified: true,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', currentApp.user_id)
          .select()
          .single();

        if (profileError) {
          console.error('Profile update error:', profileError);
          throw new Error('Failed to update seller profile');
        }

        profileId = updatedProfile.profile_id;
        console.log(`✅ Updated existing seller profile: ${profileId}`);
      } else {
        // Create new profile
        const { data: newProfile, error: profileError } = await supabase
          .from('seller_profiles')
          .insert({
            user_id: currentApp.user_id,
            business_name: currentApp.store_name,
            business_registration_number: currentApp.business_id,
            store_address: currentApp.store_address,
            store_category: currentApp.store_category,
            logo_url: currentApp.store_logo_url,
            business_cert_url: currentApp.business_cert_url,
            pickup_options: currentApp.pickup_options,
            operating_hours: currentApp.active_hours,
            is_verified: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (profileError) {
          console.error('Profile creation error:', profileError);
          throw new Error('Failed to create seller profile');
        }

        profileId = newProfile.profile_id;
        console.log(`✅ Created new seller profile: ${profileId}`);
      }

      // 2. Create/Update seller bank account
      const { data: existingBank } = await supabase
        .from('seller_bank_accounts')
        .select('account_id')
        .eq('user_id', currentApp.user_id)
        .eq('account_number', currentApp.account_number)
        .single();

      if (existingBank) {
        // Update existing
        await supabase
          .from('seller_bank_accounts')
          .update({
            profile_id: profileId,
            bank_name: currentApp.bank_name,
            bank_code: currentApp.bank_code,
            account_name: currentApp.account_name,
            is_primary: true,
            status: 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('account_id', existingBank.account_id);

        console.log(`✅ Updated existing bank account`);
      } else {
        // Create new
        const { error: bankError } = await supabase
          .from('seller_bank_accounts')
          .insert({
            user_id: currentApp.user_id,
            profile_id: profileId,
            account_number: currentApp.account_number,
            bank_name: currentApp.bank_name,
            bank_code: currentApp.bank_code,
            account_name: currentApp.account_name,
            is_primary: true,
            status: 'active',
          });

        if (bankError) {
          console.error('Bank account creation error:', bankError);
          throw new Error('Failed to create bank account');
        }

        console.log(`✅ Created new bank account`);
      }

      console.log(`=== APPROVAL SETUP COMPLETED ===\n`);
    }

    // Update application
    const updateData: any = {
      status,
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
      admin_notes: notes,
      updated_at: new Date().toISOString()
    };

    if (status === 'approved') {
      updateData.approved_at = new Date().toISOString();
    }

    if (status === 'rejected' && reason) {
      updateData.rejection_reason = reason;
    }

    const { data: updatedApp, error: updateError } = await supabase
      .from('kyc_applications')
      .update(updateData)
      .eq('application_id', applicationId)
      .select()
      .single();

    if (updateError) {
      console.error('Application update error:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update application'
      });
    }

    // FIXED: Update user status with location mapping and without kyc_verified_at
    const userUpdateData: any = { 
      kyc_status: status === 'approved' ? 'verified' : status,
      updated_at: new Date().toISOString()
    };
    
    if (status === 'approved') {
      userUpdateData.role = 'seller';
      userUpdateData.account_status = 'active';
      
      // FIXED: Map location from KYC application to user
      // identity_state -> location_state
      // identity_lga -> location_city (LGA = Local Government Area)
      if (currentApp.identity_state) {
        userUpdateData.location_state = currentApp.identity_state;
      }
      if (currentApp.identity_lga) {
        userUpdateData.location_city = currentApp.identity_lga;
      }
      
      // Note: kyc_verified_at column doesn't exist in users table - removed
    }

    const { error: userUpdateError } = await supabase
      .from('users')
      .update(userUpdateData)
      .eq('user_id', currentApp.user_id);
    
    // FIXED: Add error logging for user update
    if (userUpdateError) {
      console.error('User update error:', userUpdateError);
      // Don't fail the whole request, but log it
    } else {
      console.log(`✅ User updated: role=${userUpdateData.role}, location_state=${userUpdateData.location_state || 'N/A'}, location_city=${userUpdateData.location_city || 'N/A'}`);
    }

    // Log status change
    await supabase
      .from('kyc_status_history')
      .insert({
        application_id: applicationId,
        from_status: oldStatus,
        to_status: status,
        changed_by: adminId,
        reason: notes || reason || `Status changed to ${status} by admin`
      });

    // Send notification email to user
    try {
      const user = currentApp.users;
      if (user && status === 'approved') {
        await emailService.sendKycApprovalEmail({
          name: user.name,
          email: user.email,
          storeName: currentApp.store_name
        });
      } else if (user && status === 'rejected') {
        await emailService.sendKycRejectionEmail({
          name: user.name,
          email: user.email,
          reason: reason || 'Please review your application details',
          applicationId: applicationId
        });
      }
    } catch (emailError) {
      console.error('Failed to send status notification email:', emailError);
    }

    res.json({
      success: true,
      message: `Application ${status} successfully`,
      data: {
        application: updatedApp,
        old_status: oldStatus,
        new_status: status
      }
    });

  } catch (error) {
    console.error('Admin status update error:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error'
    });
  }
});

// Bulk approve/reject applications
router.post('/applications/bulk-action', async (req: AuthRequest, res: Response) => {
  try {
    const { applicationIds, action, reason, notes } = req.body;
    const adminId = req.user!.id;
    
    // Check if adminId is a valid UUID (not mock admin)
    const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(adminId);
    const reviewedBy = isValidUUID ? adminId : null;

    if (!applicationIds || !Array.isArray(applicationIds) || applicationIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Application IDs are required'
      });
    }

    const validActions = ['approve', 'reject', 'under_review'];
    if (!validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action'
      });
    }

    const status = action === 'approve' ? 'approved' : 
                  action === 'reject' ? 'rejected' : 'under_review';

    const results = [];

    // Process each application
    for (const appId of applicationIds) {
      try {
        // Get application - FIXED
        const { data: app } = await supabase
          .from('kyc_applications')
          .select(`
            *,
            users:user_id(name, email)
          `)
          .eq('application_id', appId)
          .single();

        if (!app) {
          results.push({ application_id: appId, success: false, message: 'Not found' });
          continue;
        }

        // Update application
        const updateData: any = {
          status,
          reviewed_by: reviewedBy,
          reviewed_at: new Date().toISOString(),
          admin_notes: notes,
          updated_at: new Date().toISOString()
        };

        if (status === 'approved') {
          updateData.approved_at = new Date().toISOString();
        }

        if (status === 'rejected' && reason) {
          updateData.rejection_reason = reason;
        }

        await supabase
          .from('kyc_applications')
          .update(updateData)
          .eq('application_id', appId);

        // FIXED: Update user with location mapping
        const userUpdate: any = { 
          kyc_status: status === 'approved' ? 'verified' : status,
          updated_at: new Date().toISOString()
        };
        
        if (status === 'approved') {
          userUpdate.role = 'seller';
          userUpdate.account_status = 'active';
          
          // Map location from KYC application to user
          if (app.identity_state) {
            userUpdate.location_state = app.identity_state;
          }
          if (app.identity_lga) {
            userUpdate.location_city = app.identity_lga;
          }
        }

        const { error: userUpdateError } = await supabase
          .from('users')
          .update(userUpdate)
          .eq('user_id', app.user_id);
        
        if (userUpdateError) {
          console.error(`User update error for ${appId}:`, userUpdateError);
        }

        // Log status change
        await supabase
          .from('kyc_status_history')
          .insert({
            application_id: appId,
            from_status: app.status,
            to_status: status,
            changed_by: adminId,
            reason: `Bulk ${action} by admin`
          });

        results.push({ application_id: appId, success: true });

      } catch (error) {
        console.error(`Error processing application ${appId}:`, error);
        results.push({ application_id: appId, success: false, message: 'Processing failed' });
      }
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.json({
      success: true,
      message: `Bulk action completed: ${successful} successful, ${failed} failed`,
      data: {
        results,
        summary: { successful, failed, total: applicationIds.length }
      }
    });

  } catch (error) {
    console.error('Bulk action error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

router.post('/applications/:applicationId/document-feedback', async (req: AuthRequest, res: Response) => {
  try {
    const { applicationId } = req.params;
    const { documentId, status, feedback } = req.body;
    const adminId = req.user!.id;
    
    // Check if adminId is a valid UUID (not mock admin)
    const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(adminId);
    const reviewedBy = isValidUUID ? adminId : null;

    // Validate status
    const validStatuses = ['blur_selfie', 'invalid_document', 'expired_cac', 'approved'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document status'
      });
    }

    // Update document status
    const { error: docError } = await supabase
      .from('kyc_documents')
      .update({
        verification_status: status === 'approved' ? 'approved' : 'rejected',
        rejection_reason: status !== 'approved' ? status : null,
        admin_feedback: feedback,
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString()
      })
      .eq('document_id', documentId)
      .eq('application_id', applicationId);

    if (docError) {
      console.error('Document feedback error:', docError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update document'
      });
    }

    // If any document is rejected, update application status
    if (status !== 'approved') {
      await supabase
        .from('kyc_applications')
        .update({
          status: 'resubmission_required',
          updated_at: new Date().toISOString()
        })
        .eq('application_id', applicationId);
    }

    res.json({
      success: true,
      message: 'Document feedback sent successfully',
      data: {
        documentId,
        status,
        feedback
      }
    });

  } catch (error) {
    console.error('Document feedback error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get admin dashboard stats
router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    // Get application stats
    const { data: applications } = await supabase
      .from('kyc_applications')
      .select('status, submitted_at, approved_at')
      .not('status', 'eq', 'draft');

    // Get recent activity - FIXED
    const { data: recentActivity } = await supabase
      .from('kyc_status_history')
      .select(`
        *,
        kyc_applications!inner(store_name),
        changed_by_user:changed_by(name)
      `)
      .order('created_at', { ascending: false })
      .limit(10);

    // Calculate stats
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const stats = {
      total_applications: applications?.length || 0,
      pending_review: applications?.filter(a => a.status === 'submitted').length || 0,
      under_review: applications?.filter(a => a.status === 'under_review').length || 0,
      approved_total: applications?.filter(a => a.status === 'approved').length || 0,
      rejected_total: applications?.filter(a => a.status === 'rejected').length || 0,
      
      // Recent stats (last 30 days)
      recent_submissions: applications?.filter(a => 
        a.submitted_at && new Date(a.submitted_at) > thirtyDaysAgo
      ).length || 0,
      
      recent_approvals: applications?.filter(a => 
        a.approved_at && new Date(a.approved_at) > thirtyDaysAgo
      ).length || 0,

      // Average processing time (in days)
      avg_processing_time: applications
        ?.filter(a => a.approved_at && a.submitted_at)
        .reduce((acc, a) => {
          const submitted = new Date(a.submitted_at);
          const approved = new Date(a.approved_at);
          const days = (approved.getTime() - submitted.getTime()) / (1000 * 60 * 60 * 24);
          return acc + days;
        }, 0) / (applications?.filter(a => a.approved_at && a.submitted_at).length || 1) || 0
    };

    res.json({
      success: true,
      data: {
        stats,
        recent_activity: recentActivity || []
      }
    });

  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export default router;