import { ForgeSteelCharacterSnapshotPayload } from '@/integrations/owlbear-bridge';
import { Hero } from '@/models/hero';
import { HeroLogic } from '@/logic/hero-logic';
import { HeroSheetBuilder } from '@/logic/hero-sheet/hero-sheet-builder';
import { Options } from '@/models/options';
import { Sourcebook } from '@/models/sourcebook';

export function buildOwlbearCharacterSnapshot(
	hero: Hero,
	sourcebooks: Sourcebook[],
	options: Options
): ForgeSteelCharacterSnapshotPayload {
	const sheet = HeroSheetBuilder.buildHeroSheet(hero, sourcebooks, options);

	return {
		characterId: hero.id,
		characterName: hero.name || 'Unnamed Hero',
		description: HeroLogic.getHeroDescription(hero),
		level: sheet.level,
		ancestryName: sheet.ancestryName,
		className: sheet.className,
		subclassName: sheet.subclassName,
		stamina: {
			current: sheet.stamina.current,
			max: sheet.stamina.max,
			temp: sheet.stamina.temp,
			windedAt: sheet.stamina.windedAt,
			deadAt: sheet.stamina.deadAt
		},
		recoveries: {
			current: sheet.recoveries.current,
			max: sheet.recoveries.max,
			value: sheet.recoveries.value
		},
		characteristics: {
			might: sheet.might,
			agility: sheet.agility,
			reason: sheet.reason,
			intuition: sheet.intuition,
			presence: sheet.presence
		},
		movement: {
			size: sheet.size,
			speed: sheet.speed,
			stability: sheet.stability,
			disengage: sheet.disengage
		},
		potencies: {
			weak: sheet.potencyWeak,
			average: sheet.potencyAverage,
			strong: sheet.potencyStrong
		},
		save: {
			target: sheet.saveTarget,
			bonus: sheet.saveBonus
		},
		immunities: sheet.immunities.map(modifier => ({
			damageType: modifier.damageType.toString(),
			value: modifier.value
		})),
		weaknesses: sheet.weaknesses.map(modifier => ({
			damageType: modifier.damageType.toString(),
			value: modifier.value
		})),
		conditionImmunities: (sheet.conditionImmunities || []).map(condition => condition.toString()),
		conditions: (sheet.conditions || []).map(condition => ({
			id: condition.id,
			type: condition.type.toString(),
			text: condition.text,
			ends: condition.ends.toString()
		})),
		updatedAt: new Date().toISOString()
	};
}
