import { IsArray, IsNumber, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { LinkWithOppositeNodeDto } from './link-with-opposite-node.dto';

/**
 * 주어진 Frame 구간에 대해 가장 유사한 링크 매칭 결과를 담는 DTO
 */
export class BestLinkResultDto {
  /** 매칭된 Link 및 반대 Node 정보 */
  @ValidateNested()
  @Type(() => LinkWithOppositeNodeDto)
  link: LinkWithOppositeNodeDto;

  /** 구간 내 마지막으로 포함된 Frame의 ID */
  @IsNumber()
  lastFrameInSegment: number;

  /** 각 Frame이 Link에 투영(projection)된 거리(m) 목록 */
  @IsArray()
  @IsNumber({}, { each: true })
  distances: number[];
}
