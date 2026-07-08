/**
 * Memoria 動画推薦サービス
 *
 * Zoom/VTT 側で作成した recording_segments と video_recommendations を
 * PWA から読める形に整形し、受講者の反応を video_events に記録する。
 */

const VideoService = {
  /**
   * 必要なシートを作成する。初回だけ Apps Script から手動実行する。
   */
  initVideoRecommendationSheets() {
    getOrCreateSheet(CONFIG.SHEETS.RECORDING_SEGMENTS);
    getOrCreateSheet(CONFIG.SHEETS.VIDEO_RECOMMENDATIONS);
    getOrCreateSheet(CONFIG.SHEETS.VIDEO_EVENTS);
    return {
      ok: true,
      sheets: [
        CONFIG.SHEETS.RECORDING_SEGMENTS,
        CONFIG.SHEETS.VIDEO_RECOMMENDATIONS,
        CONFIG.SHEETS.VIDEO_EVENTS,
      ],
    };
  },

  /**
   * 学生向け動画推薦を取得する。
   * studentNumber を優先し、端末変更時は studentId でフォールバックする。
   */
  getVideoRecommendations({ studentId, studentNumber, limit }) {
    if (!studentId && !studentNumber) {
      return { error: 'studentId or studentNumber is required' };
    }

    const recommendationSheet = getOrCreateSheet(CONFIG.SHEETS.VIDEO_RECOMMENDATIONS);
    const recommendationTable = readSheetTable_(recommendationSheet);
    if (recommendationTable.rows.length === 0) {
      return { recommendations: [], total: 0 };
    }

    const segmentMap = buildRecordingSegmentMap_();
    const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 3, 10));
    const allowedStatuses = { approved: true, shown: true };
    const idx = recommendationTable.idx;

    const recommendations = recommendationTable.rows
      .filter(row => {
        const rowStudentNumber = getCell_(row, idx, 'student_number');
        const rowStudentId = getCell_(row, idx, 'student_id');
        const normalizedStudentNumber = String(studentNumber || '');
        const matchesStudentNumber = studentNumber &&
          (rowStudentNumber === normalizedStudentNumber || rowStudentId === normalizedStudentNumber);
        const matchesStudentId = studentId && rowStudentId === String(studentId);
        if (!matchesStudentNumber && !matchesStudentId) return false;

        const status = getCell_(row, idx, 'status') || 'approved';
        return allowedStatuses[status] === true;
      })
      .sort((a, b) => toNumber_(getCell_(b, idx, 'score')) - toNumber_(getCell_(a, idx, 'score')))
      .slice(0, safeLimit)
      .map(row => rowToVideoRecommendation_(row, idx, segmentMap));

    return {
      recommendations: recommendations,
      total: recommendations.length,
    };
  },

  /**
   * 受講者の反応を記録する。
   * eventType: opened / viewed / later / wrong_content
   */
  markVideoRecommendation({ recommendationId, studentId, studentNumber, eventType, feedback }) {
    if (!recommendationId) {
      return { error: 'recommendationId is required' };
    }

    const normalizedEventType = String(eventType || '').trim();
    const allowedEvents = {
      opened: true,
      viewed: true,
      later: true,
      wrong_content: true,
    };
    if (!allowedEvents[normalizedEventType]) {
      return { error: 'invalid eventType: ' + normalizedEventType };
    }

    const recommendationSheet = getOrCreateSheet(CONFIG.SHEETS.VIDEO_RECOMMENDATIONS);
    const eventSheet = getOrCreateSheet(CONFIG.SHEETS.VIDEO_EVENTS);
    const recommendationTable = readSheetTable_(recommendationSheet);
    const idx = recommendationTable.idx;
    const now = new Date().toISOString();

    let matchedRowNumber = 0;
    let questionId = '';
    let segmentId = '';

    for (let i = 0; i < recommendationTable.rows.length; i++) {
      const row = recommendationTable.rows[i];
      const rowRecommendationId = getFirstCell_(row, idx, ['recommendation_id', 'recommendation_key']);
      if (rowRecommendationId === String(recommendationId)) {
        matchedRowNumber = i + 2;
        questionId = getCell_(row, idx, 'question_id');
        segmentId = getFirstCell_(row, idx, ['segment_id', 'segment_key']);
        break;
      }
    }

    if (!matchedRowNumber) {
      return { error: 'recommendation not found: ' + recommendationId };
    }

    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);

      appendByHeader_(eventSheet, {
        event_id: Utilities.getUuid(),
        recommendation_key: recommendationId,
        recommendation_id: recommendationId,
        student_id: studentId || '',
        student_number: studentNumber || '',
        event_type: normalizedEventType,
        question_id: questionId,
        segment_key: segmentId,
        segment_id: segmentId,
        feedback: feedback || '',
        created_at: now,
      });

      const headers = recommendationTable.headers;
      updateRecommendationStatus_(
        recommendationSheet,
        headers,
        matchedRowNumber,
        normalizedEventType,
        feedback || '',
        now
      );
    } finally {
      lock.releaseLock();
    }

    return {
      ok: true,
      recommendationId: recommendationId,
      eventType: normalizedEventType,
    };
  },
};

function buildRecordingSegmentMap_() {
  const segmentSheet = getOrCreateSheet(CONFIG.SHEETS.RECORDING_SEGMENTS);
  const table = readSheetTable_(segmentSheet);
  const map = {};
  table.rows.forEach(row => {
    const segmentId = getFirstCell_(row, table.idx, ['segment_id', 'segment_key']);
    if (segmentId) {
      map[segmentId] = rowToSegment_(row, table.idx);
    }
  });
  return map;
}

function rowToSegment_(row, idx) {
  const driveFileId = getFirstCell_(row, idx, ['drive_file_id', 'transcript_file_id']);
  const driveFolderId = getCell_(row, idx, 'drive_folder_id');
  const videoUrl = getCell_(row, idx, 'video_url') || buildDriveUrl_(driveFileId, driveFolderId);

  return {
    segmentId: getFirstCell_(row, idx, ['segment_id', 'segment_key']),
    scheduleKey: getCell_(row, idx, 'schedule_key'),
    department: getCell_(row, idx, 'department'),
    category: getFirstCell_(row, idx, ['category', 'segment_subject', 'subject']),
    subcategory: getFirstCell_(row, idx, ['subcategory', 'topic']),
    subtopic: getCell_(row, idx, 'subtopic'),
    keywords: getCell_(row, idx, 'keywords'),
    title: getCell_(row, idx, 'title'),
    summary: getCell_(row, idx, 'summary'),
    startSec: toNumber_(getCell_(row, idx, 'start_sec')),
    endSec: toNumber_(getCell_(row, idx, 'end_sec')),
    displayTime: getCell_(row, idx, 'display_time'),
    videoUrl: videoUrl,
    driveFileId: driveFileId || driveFolderId,
    status: getCell_(row, idx, 'status'),
    updatedAt: getFirstCell_(row, idx, ['updated_at', 'reviewed_at', 'created_at']),
  };
}

function rowToVideoRecommendation_(row, idx, segmentMap) {
  const segmentId = getFirstCell_(row, idx, ['segment_id', 'segment_key']);
  const segment = segmentMap[segmentId] || {};
  const recommendationId = getFirstCell_(row, idx, ['recommendation_id', 'recommendation_key']);
  const createdAt = getCell_(row, idx, 'created_at');

  return {
    recommendationId: recommendationId,
    studentId: getCell_(row, idx, 'student_id'),
    studentNumber: getCell_(row, idx, 'student_number'),
    questionId: getCell_(row, idx, 'question_id'),
    segmentId: segmentId,
    title: getCell_(row, idx, 'title') || segment.title || '授業動画の復習ポイント',
    summary: getCell_(row, idx, 'summary') || segment.summary || '',
    reason: getCell_(row, idx, 'reason'),
    score: toNumber_(getCell_(row, idx, 'score')),
    displayTime: getCell_(row, idx, 'display_time') || segment.displayTime || '',
    videoUrl: segment.videoUrl || '',
    driveFileId: segment.driveFileId || '',
    category: segment.category || '',
    subcategory: segment.subcategory || '',
    subtopic: segment.subtopic || '',
    status: getCell_(row, idx, 'status') || 'approved',
    updatedAt: createdAt || segment.updatedAt || '',
  };
}

function updateRecommendationStatus_(sheet, headers, rowNumber, eventType, feedback, now) {
  const idx = {};
  headers.forEach((header, i) => { idx[header] = i + 1; });

  if (idx.status) {
    let status = 'shown';
    if (eventType === 'viewed') status = 'completed';
    if (eventType === 'wrong_content') status = 'needs_review';
    sheet.getRange(rowNumber, idx.status).setValue(status);
  }
  if (idx.shown_at && (eventType === 'opened' || eventType === 'later')) {
    const currentShownAt = sheet.getRange(rowNumber, idx.shown_at).getValue();
    if (!currentShownAt) {
      sheet.getRange(rowNumber, idx.shown_at).setValue(now);
    }
  }
  if (idx.completed_at && eventType === 'viewed') {
    sheet.getRange(rowNumber, idx.completed_at).setValue(now);
  }
  if (idx.feedback && feedback) {
    sheet.getRange(rowNumber, idx.feedback).setValue(feedback);
  }
}

function readSheetTable_(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length === 0) {
    return { headers: [], idx: {}, rows: [] };
  }

  const headers = data[0].map(header => String(header).trim());
  const idx = {};
  headers.forEach((header, i) => { idx[header] = i; });
  return {
    headers: headers,
    idx: idx,
    rows: data.slice(1),
  };
}

function appendByHeader_(sheet, valueByHeader) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(header => String(header).trim());
  const row = headers.map(header => Object.prototype.hasOwnProperty.call(valueByHeader, header) ? valueByHeader[header] : '');
  sheet.appendRow(row);
}

function getCell_(row, idx, header) {
  if (idx[header] === undefined) return '';
  const value = row[idx[header]];
  return value === null || value === undefined ? '' : String(value).trim();
}

function getFirstCell_(row, idx, headers) {
  for (let i = 0; i < headers.length; i++) {
    const value = getCell_(row, idx, headers[i]);
    if (value) return value;
  }
  return '';
}

function buildDriveUrl_(driveFileId, driveFolderId) {
  if (driveFileId) {
    return 'https://drive.google.com/file/d/' + encodeURIComponent(driveFileId) + '/view';
  }
  if (driveFolderId) {
    return 'https://drive.google.com/drive/folders/' + encodeURIComponent(driveFolderId);
  }
  return '';
}

function toNumber_(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}
