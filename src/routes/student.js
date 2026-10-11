import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { createNotification } from './notifications.js';
import { mediaUpload } from './profile.js';

const router = Router();

/* =========================================================
   STUDENT MEDIA
========================================================= */

router.post(
  '/media',
  requireAuth,
  requireRole('student'),
  mediaUpload.array('media', 12),
  async (req, res, next) => {
    try {
      if (!req.files?.length) {
        return res.status(400).json({
          success: false,
          message: 'Select at least one image or walkthrough video.'
        });
      }

      const media = req.files.map((f) => ({
        url: `/uploads/${f.filename}`,
        type: f.mimetype.startsWith('video/') ? 'video' : 'image',
        name: f.originalname,
        size: f.size
      }));

      res.status(201).json({
        success: true,
        message: 'Post media uploaded.',
        media
      });
    } catch (e) {
      next(e);
    }
  }
);

/* =========================================================
   PROPERTY HELPER
========================================================= */

function propertySelect() {
  return `
    SELECT
      p.*,
      u.full_name AS provider_name
    FROM properties p
    JOIN users u ON u.id = p.provider_id
  `;
}

/* =========================================================
   FAVOURITES
========================================================= */

router.get(
  '/favourites',
  requireAuth,
  requireRole('student'),
  async (req, res, next) => {
    try {
      const [rows] = await pool.execute(
        `
        ${propertySelect()}
        JOIN favourites f ON f.property_id = p.id
        WHERE f.user_id = ?
        ORDER BY f.created_at DESC
        `,
        [req.user.id]
      );

      res.json({
        success: true,
        favourites: rows
      });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/favourites/:propertyId',
  requireAuth,
  requireRole('student'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.propertyId);

      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Invalid property.'
        });
      }

      const [p] = await pool.execute(
        `
        SELECT id
        FROM properties
        WHERE id = ?
          AND listing_status = 'approved'
          AND is_verified = 1
          AND availability_status = 'available'
        LIMIT 1
        `,
        [id]
      );

      if (!p.length) {
        return res.status(404).json({
          success: false,
          message: 'Property not found or unavailable.'
        });
      }

      await pool.execute(
        `
        INSERT IGNORE INTO favourites (user_id, property_id)
        VALUES (?, ?)
        `,
        [req.user.id, id]
      );

      res.status(201).json({
        success: true,
        message: 'Property saved to favourites.'
      });
    } catch (e) {
      next(e);
    }
  }
);

router.delete(
  '/favourites/:propertyId',
  requireAuth,
  requireRole('student'),
  async (req, res, next) => {
    try {
      await pool.execute(
        `
        DELETE FROM favourites
        WHERE user_id = ?
          AND property_id = ?
        `,
        [req.user.id, Number(req.params.propertyId)]
      );

      res.json({
        success: true,
        message: 'Property removed from favourites.'
      });
    } catch (e) {
      next(e);
    }
  }
);

/* =========================================================
   STUDENT INQUIRIES
========================================================= */

router.get(
  '/inquiries',
  requireAuth,
  requireRole('student'),
  async (req, res, next) => {
    try {
      /* ---------------------------------------------
         PROPERTY INQUIRIES
      --------------------------------------------- */

      const [propertyRows] = await pool.execute(
        `
        SELECT
          i.*,
          p.title AS property_title,
          p.area,
          p.city,
          u.full_name AS provider_name,
          u.phone AS provider_phone,
          u.email AS provider_email,
          'provider' AS source_type
        FROM inquiries i
        JOIN properties p ON p.id = i.property_id
        JOIN users u ON u.id = i.provider_id
        WHERE i.student_id = ?
        ORDER BY i.created_at DESC
        `,
        [req.user.id]
      );

      /* ---------------------------------------------
         RECEIVED ROOMMATE INTERESTS

         IMPORTANT:
         roommate_interests.message does NOT exist
         in the current database, so we do NOT select
         ri.message here.
      --------------------------------------------- */

      const [roommateRows] = await pool.execute(
        `
        SELECT
          ri.id,
          ri.created_at,
          ri.name AS responder_name,
          ri.phone AS responder_phone,
          u.email AS responder_email,

          rl.id AS listing_id,
          rl.name AS property_title,
          rl.area,
          NULL AS city,
          NULL AS provider_name,

          'roommate' AS source_type,
          'received' AS status,

          CONCAT(
            ri.name,
            ' is interested in your roommate posting and left their contact details.'
          ) AS message,

          ri.poster_response AS provider_response,

          NULL AS appointment_date,
          NULL AS appointment_time,
          NULL AS appointment_status,
          NULL AS booking_id

        FROM roommate_interests ri
        JOIN roommate_listings rl
          ON rl.id = ri.listing_id
        JOIN users u
          ON u.id = ri.student_id

        WHERE rl.student_id = ?

        ORDER BY ri.created_at DESC
        `,
        [req.user.id]
      );

      /* ---------------------------------------------
         RECEIVED TAKEOVER CONTACTS
      --------------------------------------------- */

      const [takeoverRows] = await pool.execute(
        `
        SELECT
          tc.id,
          tc.created_at,
          tc.name AS responder_name,
          tc.phone AS responder_phone,
          u.email AS responder_email,

          tl.id AS listing_id,
          tl.title AS property_title,
          tl.area,
          NULL AS city,
          NULL AS provider_name,

          'takeover' AS source_type,
          'received' AS status,

          CONCAT(
            tc.name,
            ' contacted you about your takeover posting.'
          ) AS message,

          tc.poster_response AS provider_response,

          NULL AS appointment_date,
          NULL AS appointment_time,
          NULL AS appointment_status,
          NULL AS booking_id

        FROM takeover_contacts tc
        JOIN takeover_listings tl
          ON tl.id = tc.listing_id
        JOIN users u
          ON u.id = tc.student_id

        WHERE tl.student_id = ?

        ORDER BY tc.created_at DESC
        `,
        [req.user.id]
      );

      /* ---------------------------------------------
         SENT ROOMMATE INTERESTS

         IMPORTANT:
         No ri.message because that column does
         not exist in the database.
      --------------------------------------------- */

      const [roommateSentRows] = await pool.execute(
        `
        SELECT
          ri.id,
          ri.created_at,

          u.full_name AS responder_name,
          u.phone AS responder_phone,
          u.email AS responder_email,

          rl.id AS listing_id,
          rl.name AS property_title,
          rl.area,

          NULL AS city,

          pu.full_name AS provider_name,

          'roommate' AS source_type,

          CASE
            WHEN ri.poster_response IS NULL
            THEN 'sent'
            ELSE 'responded'
          END AS status,

          CONCAT(
            'You expressed interest in ',
            rl.name,
            '''s roommate posting.'
          ) AS message,

          ri.poster_response AS provider_response,

          NULL AS appointment_date,
          NULL AS appointment_time,
          NULL AS appointment_status,
          NULL AS booking_id

        FROM roommate_interests ri

        JOIN roommate_listings rl
          ON rl.id = ri.listing_id

        JOIN users u
          ON u.id = rl.student_id

        JOIN users pu
          ON pu.id = rl.student_id

        WHERE ri.student_id = ?

        ORDER BY ri.created_at DESC
        `,
        [req.user.id]
      );

      /* ---------------------------------------------
         SENT TAKEOVER CONTACTS
      --------------------------------------------- */

      const [takeoverSentRows] = await pool.execute(
        `
        SELECT
          tc.id,
          tc.created_at,

          u.full_name AS responder_name,
          u.phone AS responder_phone,
          u.email AS responder_email,

          tl.id AS listing_id,
          tl.title AS property_title,
          tl.area,

          NULL AS city,

          pu.full_name AS provider_name,

          'takeover' AS source_type,

          CASE
            WHEN tc.poster_response IS NULL
            THEN 'sent'
            ELSE 'responded'
          END AS status,

          CONCAT(
            'You contacted the poster about ',
            tl.title,
            '.'
          ) AS message,

          tc.poster_response AS provider_response,

          NULL AS appointment_date,
          NULL AS appointment_time,
          NULL AS appointment_status,
          NULL AS booking_id

        FROM takeover_contacts tc

        JOIN takeover_listings tl
          ON tl.id = tc.listing_id

        JOIN users u
          ON u.id = tl.student_id

        JOIN users pu
          ON pu.id = tl.student_id

        WHERE tc.student_id = ?

        ORDER BY tc.created_at DESC
        `,
        [req.user.id]
      );

      /* ---------------------------------------------
         COMBINE ALL INQUIRIES
      --------------------------------------------- */

      const inquiries = [
        ...propertyRows,
        ...roommateRows,
        ...takeoverRows,
        ...roommateSentRows,
        ...takeoverSentRows
      ].sort(
        (a, b) =>
          new Date(b.created_at) - new Date(a.created_at)
      );

      res.json({
        success: true,
        inquiries
      });
    } catch (e) {
      next(e);
    }
  }
);

/* =========================================================
   CREATE PROPERTY INQUIRY
========================================================= */

router.post(
  '/inquiries',
  requireAuth,
  requireRole('student'),
  async (req, res, next) => {
    try {
      const propertyId = Number(req.body?.property_id);
      const message = String(req.body?.message || '').trim();

      const preferredViewingDate =
        req.body?.preferred_viewing_date
          ? String(req.body.preferred_viewing_date).trim()
          : null;

      const preferredViewingTime =
        req.body?.preferred_viewing_time
          ? String(req.body.preferred_viewing_time).trim()
          : null;

      if (!propertyId || !message) {
        return res.status(400).json({
          success: false,
          message: 'Property and message are required.'
        });
      }

      if (message.length > 2000) {
        return res.status(400).json({
          success: false,
          message: 'Message is too long.'
        });
      }

      if (
        preferredViewingDate &&
        !/^\d{4}-\d{2}-\d{2}$/.test(preferredViewingDate)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid preferred viewing date.'
        });
      }

      if (
        preferredViewingTime &&
        !/^\d{2}:\d{2}$/.test(preferredViewingTime)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid preferred viewing time.'
        });
      }

      const [rows] = await pool.execute(
        `
        ${propertySelect()}
        WHERE p.id = ?
          AND p.listing_status = 'approved'
          AND p.is_verified = 1
        LIMIT 1
        `,
        [propertyId]
      );

      if (!rows.length) {
        return res.status(404).json({
          success: false,
          message: 'Property not found or unavailable.'
        });
      }

      const p = rows[0];

      const [result] = await pool.execute(
        `
        INSERT INTO inquiries
        (
          student_id,
          provider_id,
          property_id,
          inquiry_type,
          message,
          preferred_viewing_date,
          preferred_viewing_time
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          req.user.id,
          p.provider_id,
          propertyId,
          'property_viewing',
          message,
          preferredViewingDate,
          preferredViewingTime
        ]
      );

      await createNotification(
        p.provider_id,
        'inquiry',
        'New student inquiry',
        `${req.user.full_name} is interested in ${p.title}.`,
        {
          inquiry_id: result.insertId,
          property_id: propertyId
        }
      );

      const [created] = await pool.execute(
        `
        SELECT
          i.*,
          p.title AS property_title,
          p.area,
          p.city,
          u.full_name AS provider_name
        FROM inquiries i
        JOIN properties p
          ON p.id = i.property_id
        JOIN users u
          ON u.id = i.provider_id
        WHERE i.id = ?
        `,
        [result.insertId]
      );

      res.status(201).json({
        success: true,
        message: 'Inquiry sent to the provider.',
        inquiry: created[0]
      });
    } catch (e) {
      next(e);
    }
  }
);

/* =========================================================
   CANCEL INQUIRY
========================================================= */

router.patch(
  '/inquiries/:id/cancel',
  requireAuth,
  requireRole('student'),
  async (req, res, next) => {
    try {
      const [r] = await pool.execute(
        `
        UPDATE inquiries
        SET
          status = 'closed',
          appointment_status = 'declined'
        WHERE id = ?
          AND student_id = ?
          AND status IN ('pending', 'responded')
        `,
        [req.params.id, req.user.id]
      );

      if (!r.affectedRows) {
        return res.status(404).json({
          success: false,
          message: 'Inquiry not found or already closed.'
        });
      }

      res.json({
        success: true,
        message: 'Inquiry closed.'
      });
    } catch (e) {
      next(e);
    }
  }
);

/* =========================================================
   ROOMMATE FINDER
========================================================= */

const TRAIT_OPTIONS = [
  'Clean',
  'Quiet',
  'Non-smoker',
  'Early sleeper',
  'Night owl',
  'Studious',
  'Friendly',
  'Organised',
  'Pet-friendly',
  'Vegetarian/Halal-conscious'
];

/* =========================================================
   GET ROOMMATE LISTINGS
========================================================= */

router.get(
  '/roommates',
  requireAuth,
  requireRole('student'),
  async (req, res, next) => {
    try {
      const [rows] = await pool.execute(
        `
        SELECT
          rl.*,
          u.full_name AS poster_name,

          (rl.student_id = ?) AS is_mine,

          EXISTS(
            SELECT 1
            FROM roommate_interests ri
            WHERE ri.listing_id = rl.id
              AND ri.student_id = ?
          ) AS already_interested

        FROM roommate_listings rl
        JOIN users u
          ON u.id = rl.student_id

        WHERE rl.status = 'active'

        ORDER BY rl.created_at DESC
        `,
        [req.user.id, req.user.id]
      );

      const listings = rows.map((r) => ({
        ...r,
        traits: safeJsonParse(r.traits, []),
        media: safeJsonParse(r.media, []),
        is_mine: Boolean(r.is_mine),
        already_interested: Boolean(r.already_interested)
      }));

      res.json({
        success: true,
        listings,
        traitOptions: TRAIT_OPTIONS
      });
    } catch (e) {
      next(e);
    }
  }
);

/* =========================================================
   MY ROOMMATE LISTINGS
========================================================= */

router.get(
  '/roommates/mine',
  requireAuth,
  requireRole('student'),
  async (req, res, next) => {
    try {
      const [rows] = await pool.execute(
        `
        SELECT *
        FROM roommate_listings
        WHERE student_id = ?
        ORDER BY created_at DESC
        `,
        [req.user.id]
      );

      const listings = [];

      for (const r of rows) {
        const [interests] = await pool.execute(
          `
          SELECT
            id,
            name,
            level,
            age,
            phone,
            created_at
          FROM roommate_interests
          WHERE listing_id = ?
          ORDER BY created_at DESC
          `,
          [r.id]
        );

        listings.push({
          ...r,
          traits: safeJsonParse(r.traits, []),
          media: safeJsonParse(r.media, []),
          interests
        });
      }

      res.json({
        success: true,
        listings
      });
    } catch (e) {
      next(e);
    }
  }
);

/* =========================================================
   CREATE ROOMMATE LISTING
========================================================= */

router.post(
  '/roommates',
  requireAuth,
  requireRole('student'),
  async (req, res, next) => {
    try {
      const b = req.body || {};

      const name = String(b.name || '').trim();
      const level = String(b.level || '').trim();
      const course = String(b.course || '').trim();
      const area = String(b.area || '').trim();
      const duration = String(b.duration || '').trim();
      const description = String(b.description || '').trim();

      const gender = ['male', 'female', 'any'].includes(
        b.gender_preference
      )
        ? b.gender_preference
        : 'any';

      const traits = Array.isArray(b.traits)
        ? b.traits.filter((t) => TRAIT_OPTIONS.includes(t))
        : [];

      const rent = Number(b.rent);
      const split = Number(b.split_cost);

      const media = Array.isArray(b.media)
        ? b.media.slice(0, 12)
        : [];

      if (!name || !level || !course || !area || !duration) {
        return res.status(400).json({
          success: false,
          message:
            'Name, level, course, area and duration are required.'
        });
      }

      if (
        !Number.isFinite(rent) ||
        rent < 0 ||
        !Number.isFinite(split) ||
        split < 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Rent and split cost must be non-negative numbers.'
        });
      }

      const [result] = await pool.execute(
        `
        INSERT INTO roommate_listings
        (
          student_id,
          name,
          level,
          course,
          area,
          gender_preference,
          traits,
          description,
          media,
          rent,
          split_cost,
          duration
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          req.user.id,
          name,
          level,
          course,
          area,
          gender,
          JSON.stringify(traits),
          description || null,
          JSON.stringify(media),
          rent,
          split,
          duration
        ]
      );

      res.status(201).json({
        success: true,
        message: 'Your roommate posting is live.',
        id: result.insertId
      });
    } catch (e) {
      next(e);
    }
  }
);

/* =========================================================
   CLOSE ROOMMATE LISTING
========================================================= */

router.delete(
  '/roommates/:id',
  requireAuth,
  requireRole('student'),
  async (req, res, next) => {
    try {
      const [r] = await pool.execute(
        `
        UPDATE roommate_listings
        SET status = 'closed'
        WHERE id = ?
          AND student_id = ?
        `,
        [req.params.id, req.user.id]
      );

      if (!r.affectedRows) {
        return res.status(404).json({
          success: false,
          message: 'Listing not found.'
        });
      }

      res.json({
        success: true,
        message: 'Posting closed.'
      });
    } catch (e) {
      next(e);
    }
  }
);

/* =========================================================
   EXPRESS INTEREST IN ROOMMATE LISTING

   IMPORTANT:
   We intentionally do NOT insert message because the
   current roommate_interests table has no message column.
========================================================= */

router.post(
  '/roommates/:id/interest',
  requireAuth,
  requireRole('student'),
  async (req, res, next) => {
    try {
      const b = req.body || {};

      const name = String(b.name || '').trim();
      const level = String(b.level || '').trim();
      const phone = String(b.phone || '').trim();

      const age = Number(b.age);

      if (
        !name ||
        !level ||
        !phone ||
        !Number.isInteger(age) ||
        age < 15 ||
        age > 80
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Name, level, a valid age and phone number are required.'
        });
      }

      const [rows] = await pool.execute(
        `
        SELECT
          rl.*,
          u.full_name AS poster_name,
          u.phone AS poster_phone,
          u.email AS poster_email
        FROM roommate_listings rl
        JOIN users u
          ON u.id = rl.student_id
        WHERE rl.id = ?
          AND rl.status = 'active'
        LIMIT 1
        `,
        [req.params.id]
      );

      if (!rows.length) {
        return res.status(404).json({
          success: false,
          message:
            'This roommate posting is no longer available.'
        });
      }

      const listing = rows[0];

      if (listing.student_id === req.user.id) {
        return res.status(400).json({
          success: false,
          message:
            'You cannot express interest in your own posting.'
        });
      }

      /*
       * No "message" column here.
       */
      await pool.execute(
        `
        INSERT INTO roommate_interests
        (
          listing_id,
          student_id,
          name,
          level,
          age,
          phone
        )
        VALUES (?, ?, ?, ?, ?, ?)

        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          level = VALUES(level),
          age = VALUES(age),
          phone = VALUES(phone)
        `,
        [
          req.params.id,
          req.user.id,
          name,
          level,
          age,
          phone
        ]
      );

      await createNotification(
        listing.student_id,
        'roommate_interest',
        'New roommate interest',
        `${name} is interested in your "${listing.name}" roommate posting.`,
        {
          listing_id: Number(req.params.id)
        }
      );

      res.status(201).json({
        success: true,
        message:
          'Your interest has been sent to the poster.',
        poster: {
          name: listing.poster_name,
          phone: listing.poster_phone || null,
          email: listing.poster_email
        }
      });
    } catch (e) {
      next(e);
    }
  }
);

/* =========================================================
   RESPOND TO ROOMMATE INTEREST
========================================================= */

router.patch(
  '/roommates/interests/:id/respond',
  requireAuth,
  requireRole('student'),
  async (req, res, next) => {
    try {
      const response = String(
        req.body?.response || ''
      ).trim();

      if (!response) {
        return res.status(400).json({
          success: false,
          message: 'Response is required.'
        });
      }

      const [rows] = await pool.execute(
        `
        SELECT
          ri.id,
          ri.student_id,
          rl.student_id AS poster_id,
          rl.name
        FROM roommate_interests ri
        JOIN roommate_listings rl
          ON rl.id = ri.listing_id
        WHERE ri.id = ?
          AND rl.student_id = ?
        LIMIT 1
        `,
        [req.params.id, req.user.id]
      );

      if (!rows.length) {
        return res.status(404).json({
          success: false,
          message:
            'Interest not found on your posting.'
        });
      }

      await pool.execute(
        `
        UPDATE roommate_interests
        SET poster_response = ?
        WHERE id = ?
        `,
        [response, req.params.id]
      );

      await createNotification(
        rows[0].student_id,
        'roommate_response',
        'Roommate Finder response',
        `${req.user.full_name} responded to your interest in ${rows[0].name}.`,
        {
          interest_id: rows[0].id,
          listing_id: null
        }
      );

      res.json({
        success: true,
        message: 'Response sent to the student.'
      });
    } catch (e) {
      next(e);
    }
  }
);

/* =========================================================
   TAKEOVER LISTINGS
========================================================= */

router.get(
  '/takeovers',
  requireAuth,
  requireRole('student'),
  async (req, res, next) => {
    try {
      const [rows] = await pool.execute(
        `
        SELECT
          tl.*,
          u.full_name AS poster_name,

          (tl.student_id = ?) AS is_mine,

          EXISTS(
            SELECT 1
            FROM takeover_contacts tc
            WHERE tc.listing_id = tl.id
              AND tc.student_id = ?
          ) AS already_contacted

        FROM takeover_listings tl
        JOIN users u
          ON u.id = tl.student_id

        WHERE tl.status = 'active'

        ORDER BY tl.created_at DESC
        `,
        [req.user.id, req.user.id]
      );

      const listings = rows.map((r) => ({
        ...r,
        media: safeJsonParse(r.media, []),
        is_mine: Boolean(r.is_mine),
        already_contacted: Boolean(r.already_contacted)
      }));

      res.json({
        success: true,
        listings
      });
    } catch (e) {
      next(e);
    }
  }
);

/* =========================================================
   MY TAKEOVER LISTINGS
========================================================= */

router.get(
  '/takeovers/mine',
  requireAuth,
  requireRole('student'),
  async (req, res, next) => {
    try {
      const [rows] = await pool.execute(
        `
        SELECT *
        FROM takeover_listings
        WHERE student_id = ?
        ORDER BY created_at DESC
        `,
        [req.user.id]
      );

      const listings = [];

      for (const r of rows) {
        const [contacts] = await pool.execute(
          `
          SELECT
            id,
            name,
            phone,
            message,
            created_at
          FROM takeover_contacts
          WHERE listing_id = ?
          ORDER BY created_at DESC
          `,
          [r.id]
        );

        listings.push({
          ...r,
          media: safeJsonParse(r.media, []),
          contacts
        });
      }

      res.json({
        success: true,
        listings
      });
    } catch (e) {
      next(e);
    }
  }
);

/* =========================================================
   CREATE TAKEOVER LISTING
========================================================= */

router.post(
  '/takeovers',
  requireAuth,
  requireRole('student'),
  async (req, res, next) => {
    try {
      const b = req.body || {};

      const title = String(b.title || '').trim();
      const area = String(b.area || '').trim();
      const reason = String(b.reason || '').trim();

      const availableFrom = String(
        b.available_from || ''
      ).trim();

      const description = String(
        b.description || ''
      ).trim();

      const price = Number(b.price);

      const monthsLeft =
        b.months_left === '' ||
        b.months_left == null
          ? null
          : Number(b.months_left);

      const amountRequired =
        b.amount_required === '' ||
        b.amount_required == null
          ? null
          : Number(b.amount_required);

      const media = Array.isArray(b.media)
        ? b.media.slice(0, 12)
        : [];

      if (
        !title ||
        !area ||
        !reason ||
        !availableFrom
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Title, area, reason and availability date are required.'
        });
      }

      if (!Number.isFinite(price) || price < 0) {
        return res.status(400).json({
          success: false,
          message:
            'Price must be a non-negative number.'
        });
      }

      if (
        monthsLeft !== null &&
        (!Number.isInteger(monthsLeft) ||
          monthsLeft < 0)
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Months left must be a non-negative whole number.'
        });
      }

      if (
        amountRequired !== null &&
        (!Number.isFinite(amountRequired) ||
          amountRequired < 0)
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Amount required must be a non-negative number.'
        });
      }

      const [result] = await pool.execute(
        `
        INSERT INTO takeover_listings
        (
          student_id,
          title,
          area,
          price,
          months_left,
          amount_required,
          reason,
          available_from,
          description,
          media
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          req.user.id,
          title,
          area,
          price,
          monthsLeft,
          amountRequired,
          reason,
          availableFrom,
          description || null,
          JSON.stringify(media)
        ]
      );

      res.status(201).json({
        success: true,
        message: 'Your takeover posting is live.',
        id: result.insertId
      });
    } catch (e) {
      next(e);
    }
  }
);

/* =========================================================
   CLOSE TAKEOVER LISTING
========================================================= */

router.delete(
  '/takeovers/:id',
  requireAuth,
  requireRole('student'),
  async (req, res, next) => {
    try {
      const [r] = await pool.execute(
        `
        UPDATE takeover_listings
        SET status = 'closed'
        WHERE id = ?
          AND student_id = ?
        `,
        [req.params.id, req.user.id]
      );

      if (!r.affectedRows) {
        return res.status(404).json({
          success: false,
          message: 'Listing not found.'
        });
      }

      res.json({
        success: true,
        message: 'Posting closed.'
      });
    } catch (e) {
      next(e);
    }
  }
);

/* =========================================================
   CONTACT TAKEOVER POSTER
========================================================= */

router.post(
  '/takeovers/:id/contact',
  requireAuth,
  requireRole('student'),
  async (req, res, next) => {
    try {
      const b = req.body || {};

      const name = String(b.name || '').trim();
      const phone = String(b.phone || '').trim();
      const message = String(b.message || '').trim();

      if (!name || !phone) {
        return res.status(400).json({
          success: false,
          message: 'Name and phone number are required.'
        });
      }

      const [rows] = await pool.execute(
        `
        SELECT
          tl.*,
          u.full_name AS poster_name,
          u.phone AS poster_phone,
          u.email AS poster_email
        FROM takeover_listings tl
        JOIN users u
          ON u.id = tl.student_id
        WHERE tl.id = ?
          AND tl.status = 'active'
        LIMIT 1
        `,
        [req.params.id]
      );

      if (!rows.length) {
        return res.status(404).json({
          success: false,
          message:
            'This takeover posting is no longer available.'
        });
      }

      const listing = rows[0];

      if (listing.student_id === req.user.id) {
        return res.status(400).json({
          success: false,
          message:
            'You cannot contact yourself about your own posting.'
        });
      }

      await pool.execute(
        `
        INSERT INTO takeover_contacts
        (
          listing_id,
          student_id,
          name,
          phone,
          message
        )
        VALUES (?, ?, ?, ?, ?)

        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          phone = VALUES(phone),
          message = VALUES(message)
        `,
        [
          req.params.id,
          req.user.id,
          name,
          phone,
          message || null
        ]
      );

      await createNotification(
        listing.student_id,
        'takeover_contact',
        'New takeover contact',
        `${name} wants to talk about your "${listing.title}" posting.`,
        {
          listing_id: Number(req.params.id)
        }
      );

      res.status(201).json({
        success: true,
        message:
          'Your contact details have been sent to the poster.',
        poster: {
          name: listing.poster_name,
          phone: listing.poster_phone || null,
          email: listing.poster_email
        }
      });
    } catch (e) {
      next(e);
    }
  }
);

/* =========================================================
   RESPOND TO TAKEOVER CONTACT
========================================================= */

router.patch(
  '/takeovers/contacts/:id/respond',
  requireAuth,
  requireRole('student'),
  async (req, res, next) => {
    try {
      const response = String(
        req.body?.response || ''
      ).trim();

      if (!response) {
        return res.status(400).json({
          success: false,
          message: 'Response is required.'
        });
      }

      const [rows] = await pool.execute(
        `
        SELECT
          tc.id,
          tc.student_id,
          tl.title
        FROM takeover_contacts tc
        JOIN takeover_listings tl
          ON tl.id = tc.listing_id
        WHERE tc.id = ?
          AND tl.student_id = ?
        LIMIT 1
        `,
        [req.params.id, req.user.id]
      );

      if (!rows.length) {
        return res.status(404).json({
          success: false,
          message:
            'Takeover contact not found on your posting.'
        });
      }

      await pool.execute(
        `
        UPDATE takeover_contacts
        SET poster_response = ?
        WHERE id = ?
        `,
        [response, req.params.id]
      );

      await createNotification(
        rows[0].student_id,
        'takeover_response',
        'Takeover response',
        `${req.user.full_name} responded to your interest in ${rows[0].title}.`,
        {
          contact_id: rows[0].id
        }
      );

      res.json({
        success: true,
        message: 'Response sent to the student.'
      });
    } catch (e) {
      next(e);
    }
  }
);

/* =========================================================
   PROVIDER INQUIRIES
========================================================= */

router.get(
  '/provider/inquiries',
  requireAuth,
  requireRole('provider'),
  async (req, res, next) => {
    try {
      const [rows] = await pool.execute(
        `
        SELECT
          i.*,
          p.title AS property_title,
          p.address,
          p.area,
          p.city,

          s.full_name AS student_name,
          s.email AS student_email,
          s.phone AS student_phone

        FROM inquiries i

        JOIN properties p
          ON p.id = i.property_id

        JOIN users s
          ON s.id = i.student_id

        WHERE i.provider_id = ?

        ORDER BY i.created_at DESC
        `,
        [req.user.id]
      );

      res.json({
        success: true,
        inquiries: rows
      });
    } catch (e) {
      next(e);
    }
  }
);

/* =========================================================
   PROVIDER RESPONDS TO VIEWING REQUEST
========================================================= */

router.patch(
  '/provider/inquiries/:id/respond',
  requireAuth,
  requireRole('provider'),
  async (req, res, next) => {
    const conn = await pool.getConnection();

    try {
      const action = String(
        req.body?.action ||
        req.body?.decision ||
        'approve'
      ).toLowerCase();

      const response = String(
        req.body?.response || ''
      ).trim();

      const appointmentDate =
        req.body?.appointment_date
          ? String(req.body.appointment_date).trim()
          : null;

      const appointmentTime =
        req.body?.appointment_time
          ? String(req.body.appointment_time).trim()
          : null;

      if (
        !['approve', 'change', 'reject'].includes(action)
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Action must be approve, change or reject.'
        });
      }

      if (
        action !== 'reject' &&
        (!appointmentDate || !appointmentTime)
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Please provide an appointment date and time.'
        });
      }

      if (
        appointmentDate &&
        !/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid appointment date.'
        });
      }

      if (
        appointmentTime &&
        !/^\d{2}:\d{2}$/.test(appointmentTime)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid appointment time.'
        });
      }

      await conn.beginTransaction();

      const [rows] = await conn.execute(
        `
        SELECT *
        FROM inquiries
        WHERE id = ?
          AND provider_id = ?
          AND inquiry_type = 'property_viewing'
        FOR UPDATE
        `,
        [req.params.id, req.user.id]
      );

      if (!rows.length) {
        await conn.rollback();

        return res.status(404).json({
          success: false,
          message: 'Viewing request not found.'
        });
      }

      const i = rows[0];

      if (
        i.status === 'closed' &&
        action !== 'change'
      ) {
        await conn.rollback();

        return res.status(409).json({
          success: false,
          message:
            'This viewing request is already closed.'
        });
      }

      /* ---------------------------------------------
         REJECT
      --------------------------------------------- */

      if (action === 'reject') {
        await conn.execute(
          `
          UPDATE inquiries
          SET
            status = 'closed',
            provider_response = ?,
            appointment_status = 'declined'
          WHERE id = ?
            AND provider_id = ?
          `,
          [
            response ||
              'The provider is unable to accommodate this viewing request.',
            req.params.id,
            req.user.id
          ]
        );

        await conn.commit();

        await createNotification(
          i.student_id,
          'viewing_declined',
          'Viewing request update',
          'The provider declined your viewing request.',
          {
            inquiry_id: i.id,
            property_id: i.property_id
          }
        );

        return res.json({
          success: true,
          message: 'Viewing request declined.'
        });
      }

      /* ---------------------------------------------
         CHECK BOOKING CONFLICT
      --------------------------------------------- */

      const activeStatuses = [
        'pending_provider',
        'pending_student_confirmation',
        'approved',
        'payment_pending',
        'paid',
        'active'
      ];

      const activePlaceholders =
        activeStatuses.map(() => '?').join(',');

      const [conflict] = await conn.execute(
        `
        SELECT id
        FROM booking_requests

        WHERE property_id = ?

          AND id <> COALESCE(?, 0)

          AND status IN (${activePlaceholders})

          AND start_date <= ?

          AND (
            end_date IS NULL
            OR end_date >= ?
          )

        LIMIT 1
        `,
        [
          i.property_id,
          Number(i.booking_id || 0),
          ...activeStatuses,
          appointmentDate,
          appointmentDate
        ]
      );

      if (conflict.length) {
        await conn.rollback();

        return res.status(409).json({
          success: false,
          message:
            'That appointment slot is already occupied by another booking.'
        });
      }

      /* ---------------------------------------------
         CREATE OR UPDATE BOOKING
      --------------------------------------------- */

      let bookingId = Number(
        i.booking_id || 0
      );

      if (!bookingId) {
        const [pRows] = await conn.execute(
          `
          SELECT *
          FROM properties
          WHERE id = ?
          LIMIT 1
          `,
          [i.property_id]
        );

        if (!pRows.length) {
          await conn.rollback();

          return res.status(404).json({
            success: false,
            message: 'Property not found.'
          });
        }

        const p = pRows[0];

        const rent = Number(p.rent || 0);
        const agentFee = Number(
          p.agent_fee || 0
        );
        const serviceFee = Number(
          p.service_charge || 0
        );
        const securityDeposit = Number(
          p.security_deposit || 0
        );

        const total =
          rent +
          agentFee +
          serviceFee +
          securityDeposit;

        const [b] = await conn.execute(
          `
          INSERT INTO booking_requests
          (
            student_id,
            provider_id,
            property_id,
            start_date,
            end_date,
            appointment_date,
            appointment_time,
            rent_amount,
            agent_fee,
            service_fee,
            security_deposit,
            total_amount,
            message,
            status,
            inquiry_id
          )
          VALUES
          (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            'pending_student_confirmation',
            ?
          )
          `,
          [
            i.student_id,
            i.provider_id,
            i.property_id,
            appointmentDate,
            appointmentDate,
            appointmentDate,
            appointmentTime,
            rent,
            agentFee,
            serviceFee,
            securityDeposit,
            total,
            i.message,
            i.id
          ]
        );

        bookingId = b.insertId;
      } else {
        await conn.execute(
          `
          UPDATE booking_requests
          SET
            appointment_date = ?,
            appointment_time = ?,
            start_date = ?,
            end_date = ?,
            status = 'pending_student_confirmation',
            responded_at = NOW()
          WHERE id = ?
            AND provider_id = ?
          `,
          [
            appointmentDate,
            appointmentTime,
            appointmentDate,
            appointmentDate,
            bookingId,
            req.user.id
          ]
        );
      }

      /* ---------------------------------------------
         UPDATE INQUIRY
      --------------------------------------------- */

      const reply =
        response ||
        (
          action === 'change'
            ? 'The provider proposed a different viewing time. Please review and accept it in your Student Space.'
            : 'Your viewing appointment is available. Please review and accept the proposed time in your Student Space.'
        );

      await conn.execute(
        `
        UPDATE inquiries
        SET
          status = 'responded',
          provider_response = ?,
          appointment_date = ?,
          appointment_time = ?,
          appointment_status = 'proposed',
          booking_id = ?

        WHERE id = ?
          AND provider_id = ?
        `,
        [
          reply,
          appointmentDate,
          appointmentTime,
          bookingId,
          req.params.id,
          req.user.id
        ]
      );

      await conn.commit();

      /* ---------------------------------------------
         NOTIFY STUDENT
      --------------------------------------------- */

      await createNotification(
        i.student_id,
        'viewing_response',
        action === 'change'
          ? 'Viewing time changed'
          : 'Viewing request approved',
        `${req.user.full_name} proposed ${appointmentDate} at ${appointmentTime}.`,
        {
          inquiry_id: i.id,
          booking_id: bookingId,
          property_id: i.property_id,
          appointment_date: appointmentDate,
          appointment_time: appointmentTime
        }
      );

      res.json({
        success: true,
        message:
          action === 'change'
            ? 'Appointment date and time updated.'
            : 'Viewing request approved. Student must accept the appointment before payment becomes available.',
        booking_id: bookingId,
        appointment_date: appointmentDate,
        appointment_time: appointmentTime
      });
    } catch (e) {
      try {
        await conn.rollback();
      } catch {}

      next(e);
    } finally {
      conn.release();
    }
  }
);

/* =========================================================
   SAFE JSON HELPER
========================================================= */

function safeJsonParse(value, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/* =========================================================
   EXPORT
========================================================= */

export default router;
