const JobCard = require("../models/JobCard");
const mongoose = require("mongoose");
// 🟢 NEW: Import Order model to fetch sales pipeline stats
const Order = require("../models/Order"); 

exports.getFactoryIntelligence = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const query = {};
    if (startDate && endDate) {
      query.updatedAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    // 🟢 1. FETCH ORDER STATS (Total, Pending, Ready)
    const orderPipeline = await Order.aggregate([
      {
        $facet: {
          total: [{ $count: "count" }],
          pending: [
            { 
              $match: { 
                status: { $in: ["Production_Queued", "Production_Started"] } 
              } 
            },
            { $count: "count" }
          ],
          ready: [
            { $match: { status: "Ready_to_Dispatch" } },
            { $count: "count" }
          ]
        }
      }
    ]);

    // 📊 2. EXISTING FACTORY DATA (JobCards)
    const data = await JobCard.aggregate([
      { $match: query },
      {
        $facet: {
          // 📈 1. SALES & KPI DATA
          sales: [
            { $match: { status: "Completed" } },
            {
              $lookup: {
                from: "products",
                localField: "productId",
                foreignField: "_id",
                as: "prod",
              },
            },
            { $unwind: { path: "$prod", preserveNullAndEmptyArrays: true } },
            {
              $group: {
                _id: { $ifNull: ["$prod.name", "Unknown Art"] },
                revenue: {
                  $sum: {
                    $multiply: [
                      { $ifNull: ["$totalQty", 0] },
                      { $ifNull: ["$prod.sellingPrice", 0] },
                    ],
                  },
                },
                units: { $sum: "$totalQty" },
              },
            },
            { $sort: { revenue: -1 } },
          ],

          // 📊 2. TREND GRAPH DATA
          salesTrends: [
            { $match: { status: "Completed" } },
            {
              $lookup: {
                from: "products",
                localField: "productId",
                foreignField: "_id",
                as: "prod",
              },
            },
            { $unwind: { path: "$prod", preserveNullAndEmptyArrays: true } },
            {
              $group: {
                _id: {
                  $dateToString: { format: "%Y-%m-%d", date: "$updatedAt" },
                },
                dailyRevenue: {
                  $sum: {
                    $multiply: [
                      { $ifNull: ["$totalQty", 0] },
                      { $ifNull: ["$prod.sellingPrice", 0] },
                    ],
                  },
                },
              },
            },
            { $sort: { _id: 1 } },
          ],

          // 🚚 3. VENDOR ACCOUNTABILITY
          vendor: [
            {
              $group: {
                _id: { $ifNull: ["$vendorName", "Internal Floor"] },
                passed: { $sum: { $ifNull: ["$qcResult.passedQty", 0] } },
                rejected: { $sum: { $ifNull: ["$qcResult.rejectedQty", 0] } },
                totalAssigned: { $sum: "$totalQty" },
                pendingInFloor: {
                  $sum: {
                    $cond: [{ $ne: ["$status", "Completed"] }, "$totalQty", 0],
                  },
                },
                activeJobCards: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 1,
                passed: 1,
                rejected: 1,
                totalAssigned: 1,
                pendingInFloor: 1,
                activeJobCards: 1,
                yield: {
                  $cond: [
                    { $gt: ["$totalAssigned", 0] },
                    { $multiply: [{ $divide: ["$passed", "$totalAssigned"] }, 100] },
                    0,
                  ],
                },
              },
            },
          ],

          // 👥 4. MASTER WORKFORCE AUDIT
          "employees": [
            { $unwind: "$history" },
            {
              $group: {
                _id: { $ifNull: ["$history.performedBy", "Unknown Operator"] },
                engagement: { $sum: 1 },
                output: { $sum: "$totalQty" },
                valueManaged: { $sum: { $multiply: ["$totalQty", 100] } }, 
                lastSync: { $max: "$history.timestamp" }
              }
            },
            { $sort: { engagement: -1 } }
          ],

          // 🏭 5. PRODUCTION FLOW
          production: [
            { $match: { status: { $ne: "Completed" } } },
            {
              $group: {
                _id: "$currentStep",
                totalUnits: { $sum: "$totalQty" },
              },
            },
          ],

          // ⚠️ 6. ROOT CAUSE ANALYSIS
          defectAnalysis: [
            { $match: { "qcResult.rejectedQty": { $gt: 0 } } },
            {
              $group: {
                _id: { $ifNull: ["$qcResult.notes", "General"] },
                totalLost: { $sum: "$qcResult.rejectedQty" },
              },
            },
          ],
        },
      },
    ]);

    // 🟢 3. MERGE BOTH AGGREGATIONS INTO FINAL RESPONSE
    const result = data[0] || {
      sales: [],
      salesTrends: [],
      production: [],
      vendor: [],
      employees: [],
      defectAnalysis: [],
    };

    // Attach order pipeline stats to the result
    result.orderStats = {
      total: orderPipeline[0]?.total[0]?.count || 0,
      pending: orderPipeline[0]?.pending[0]?.count || 0,
      ready: orderPipeline[0]?.ready[0]?.count || 0
    };

    res.json(result);

  } catch (error) {
    console.error("CRITICAL AGGREGATION ERROR:", error);
    res.status(500).json({ msg: "Internal Server Error: Aggregation Pipeline Failed" });
  }
};