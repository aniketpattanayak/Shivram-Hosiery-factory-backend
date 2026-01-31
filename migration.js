// migration.js
// Run this script to add new fields to existing JobCard and ProductionPlan documents

const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    // Mongoose 9.x doesn't need these options anymore
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error);
    process.exit(1);
  }
};

// Define schemas (minimal versions for migration)
const jobCardSchema = new mongoose.Schema({}, { strict: false });
const productionPlanSchema = new mongoose.Schema({}, { strict: false });

const JobCard = mongoose.model('JobCard', jobCardSchema);
const ProductionPlan = mongoose.model('ProductionPlan', productionPlanSchema);

// Migration function for JobCards
async function migrateJobCards() {
  console.log('\n🔄 Starting JobCard migration...');
  
  const jobs = await JobCard.find({});
  let updated = 0;
  
  for (const job of jobs) {
    let needsSave = false;
    
    // Add fabricIssued if not exists
    if (!job.fabricIssued) {
      job.fabricIssued = {
        isIssued: false,
        lotNumber: '',
        qty: 0,
        issuedBy: '',
        issuedDate: null
      };
      needsSave = true;
    }
    
    // Add dispatches array if not exists
    if (!job.dispatches) {
      job.dispatches = [];
      needsSave = true;
    }
    
    // Add qcReview if not exists
    if (!job.qcReview) {
      job.qcReview = {
        isInReview: false,
        rejectionRate: 0,
        totalQty: 0,
        rejectedQty: 0,
        approvedQty: 0,
        reworkQty: 0,
        reviewedBy: '',
        reviewDate: null,
        reviewNotes: ''
      };
      needsSave = true;
    }
    
    // Add rework fields
    if (job.isRework === undefined) {
      job.isRework = false;
      job.originalJobId = '';
      job.reworkStage = '';
      needsSave = true;
    }
    
    // Add vendorId to routing if missing
    if (job.routing) {
      if (job.routing.cutting && !job.routing.cutting.vendorId) {
        job.routing.cutting.vendorId = null;
        needsSave = true;
      }
      if (job.routing.stitching && !job.routing.stitching.vendorId) {
        job.routing.stitching.vendorId = null;
        needsSave = true;
      }
      if (job.routing.packing && !job.routing.packing.vendorId) {
        job.routing.packing.vendorId = null;
        needsSave = true;
      }
    }
    
    if (needsSave) {
      await job.save();
      updated++;
    }
  }
  
  console.log(`✅ JobCard migration complete: ${updated}/${jobs.length} documents updated`);
}

// Migration function for ProductionPlans
async function migrateProductionPlans() {
  console.log('\n🔄 Starting ProductionPlan migration...');
  
  const plans = await ProductionPlan.find({});
  let updated = 0;
  
  for (const plan of plans) {
    let needsSave = false;
    
    // Update splits routing to include vendorId
    if (plan.splits && Array.isArray(plan.splits)) {
      for (const split of plan.splits) {
        if (split.routing) {
          if (split.routing.cutting && !split.routing.cutting.vendorId) {
            split.routing.cutting.vendorId = null;
            needsSave = true;
          }
          if (split.routing.stitching && !split.routing.stitching.vendorId) {
            split.routing.stitching.vendorId = null;
            needsSave = true;
          }
          if (split.routing.packing && !split.routing.packing.vendorId) {
            split.routing.packing.vendorId = null;
            needsSave = true;
          }
        }
      }
    }
    
    if (needsSave) {
      await plan.save();
      updated++;
    }
  }
  
  console.log(`✅ ProductionPlan migration complete: ${updated}/${plans.length} documents updated`);
}

// Main migration function
async function runMigration() {
  try {
    await connectDB();
    
    console.log('\n🚀 Starting Database Migration');
    console.log('================================\n');
    
    await migrateJobCards();
    await migrateProductionPlans();
    
    console.log('\n================================');
    console.log('✅ Migration completed successfully!');
    console.log('You can now restart your application.\n');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
runMigration();