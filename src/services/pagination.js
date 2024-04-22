
// =======================================
const {
    MAX_PAGE_RANGE
} = process.env;
// =======================================
// Paginate Parameters Setup
function retrievePaginationInfo(page, totalPageCount) {
  const pageRange = parseInt(MAX_PAGE_RANGE);

  const floorPageOffset = parseInt(page - 1) - pageRange;
  const ceilingPageOffset = parseInt(page - 1) + pageRange;

  // E.g. (Offset Ceiling to the Right)
  // Current Page: 2, Max Page Range: +4/-4, Total Number of Pages: 12
  // Floor Offset: -2
  // Floor Ceiling: 6
  // Start:
  // = 0
  // End: 
  // = Current Page + Max Page Range - (Floor Offset excess negative beyond 0)
  // = (2 + 4 - (-2)) = 6 + 2 = 8
  
  // E.g. (Offset Ceiling to the Left)
  // Current Page: 10, Max Page Range: +4/-4, Total Number of Pages: 12
  // Floor Offset: 6
  // Floor Ceiling: 14
  // Start:
  // = Current Page - Max Page Range - (Ceiling Offset excess positive)
  // = 10 - 4 - 2
  // = 4
  // End: 
  // = 12 (Cap at 12), excess +2.
  return {
    start_page_number: Math.max(page - pageRange - Math.max(ceilingPageOffset - totalPageCount, 0), 1),
    end_page_number: Math.min(page + pageRange - Math.min(floorPageOffset, 0), totalPageCount)
  };
}
// =======================================
module.exports = { retrievePaginationInfo };